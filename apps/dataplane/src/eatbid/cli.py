"""모듈 책임: typed CLI 인수를 실제 application method와 안정된 exit code로 dispatch한다."""

from __future__ import annotations

import argparse
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from types import TracebackType
from typing import Protocol, Self
from uuid import UUID

from eatbid.config import ApplicationSettings

CONFIGURATION_EXIT_CODE = 64
DATA_QUARANTINED_EXIT_CODE = 65
SOURCE_THROTTLED_EXIT_CODE = 75
SOURCE_CONTRACT_EXIT_CODE = 76
_SHA256 = re.compile(r"[0-9a-f]{64}")


class CliApplication(Protocol):
    def __enter__(self) -> Self: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...
    def discover(self, args: argparse.Namespace) -> None: ...
    def capture(self, args: argparse.Namespace) -> None: ...
    def normalize(self, args: argparse.Namespace) -> None: ...
    def validate(self, args: argparse.Namespace) -> None: ...
    def project(self, args: argparse.Namespace) -> None: ...
    def replay(self, args: argparse.Namespace) -> None: ...


CommandHandler = Callable[[argparse.Namespace, CliApplication], int]
ApplicationFactory = Callable[[ApplicationSettings], CliApplication]


def _handler(method_name: str) -> CommandHandler:
    def run(args: argparse.Namespace, application: CliApplication) -> int:
        getattr(application, method_name)(args)
        return 0

    return run


COMMAND_HANDLERS: Mapping[str, CommandHandler] = {
    name: _handler(name)
    for name in ("discover", "capture", "normalize", "validate", "project", "replay")
}


def _sha256(value: str) -> str:
    if _SHA256.fullmatch(value) is None:
        raise argparse.ArgumentTypeError("must be a lowercase SHA-256 digest")
    return value


def _aware_datetime(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        raise argparse.ArgumentTypeError("must be an ISO 8601 timestamp") from None
    if parsed.utcoffset() is None:
        raise argparse.ArgumentTypeError("must include a timezone offset")
    return parsed


def _positive_id(value: str) -> int:
    if not value.isascii() or not value.isdecimal() or value.startswith("0"):
        raise argparse.ArgumentTypeError("must be a positive ASCII decimal")
    parsed = int(value)
    if parsed < 1:
        raise argparse.ArgumentTypeError("must be positive")
    return parsed


def _common(command: argparse.ArgumentParser) -> None:
    command.add_argument("--run-id", required=True, type=UUID)
    command.add_argument("--source-release-id", required=True, type=UUID)
    command.add_argument("--build-sha", required=True, type=_sha256)
    command.add_argument("--parser-version", required=True)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eatbid")
    subcommands = parser.add_subparsers(dest="command", required=True)
    commands = {name: subcommands.add_parser(name) for name in COMMAND_HANDLERS}
    for command in commands.values():
        _common(command)

    discover = commands["discover"]
    discover.add_argument("--release-name", required=True)
    discover.add_argument("--as-of", required=True, type=_aware_datetime)
    discover.add_argument("--started-at", required=True, type=_aware_datetime)
    discover.add_argument("--completed-at", required=True, type=_aware_datetime)
    discover.add_argument("--start-date", required=True)
    discover.add_argument("--end-date", required=True)
    discover.add_argument("--progress-status-code", default="")
    discover.add_argument("--region-code", default="")
    discover.add_argument("--page-size", type=int, default=100)

    capture = commands["capture"]
    capture.add_argument("--external-bid-id", required=True)
    capture.add_argument("--started-at", required=True, type=_aware_datetime)

    normalize = commands["normalize"]
    normalize.add_argument("--observation-id", required=True, type=_positive_id)
    normalize.add_argument("--normalized-at", required=True, type=_aware_datetime)

    validate = commands["validate"]
    validate.add_argument("--publication-id", required=True, type=UUID)
    validate.add_argument("--validated-at", required=True, type=_aware_datetime)

    project = commands["project"]
    project.add_argument("--publication-id", required=True, type=UUID)
    project.add_argument("--activated-at", required=True, type=_aware_datetime)

    replay = commands["replay"]
    replay.add_argument("--publication-id", required=True, type=UUID)
    replay.add_argument("--observation-id", required=True, action="append", type=_positive_id)
    for name in ("started-at", "normalized-at", "validated-at", "activated-at"):
        replay.add_argument(f"--{name}", required=True, type=_aware_datetime)
    return parser


def main(
    argv: Sequence[str] | None = None,
    *,
    application_factory: ApplicationFactory | None = None,
    settings: ApplicationSettings | None = None,
) -> int:
    args = build_parser().parse_args(argv)
    try:
        settings = (
            settings
            if settings is not None
            else ApplicationSettings.model_validate({})
        )
        factory = application_factory
        if factory is None:
            from eatbid.composition import build_application

            factory = build_application
        with factory(settings) as application:
            return COMMAND_HANDLERS[args.command](args, application)
    except Exception as error:  # noqa: BLE001 - CLI는 모든 provider detail을 닫는 최종 경계다.
        exit_code = exit_code_for_error(error)
        category = {
            65: "DATA_QUARANTINED",
            75: "SOURCE_THROTTLED",
            76: "SOURCE_CONTRACT",
        }.get(exit_code, "CONFIGURATION")
        print(category, file=sys.stderr)
        return exit_code


def exit_code_for_error(error: Exception) -> int:
    from eatbid.errors import SourceContractError
    from eatbid.pipeline.capture import SourceThrottledError
    from eatbid.pipeline.normalize import DataQuarantinedError

    if isinstance(error, DataQuarantinedError):
        return DATA_QUARANTINED_EXIT_CODE
    if isinstance(error, SourceThrottledError):
        return SOURCE_THROTTLED_EXIT_CODE
    if isinstance(error, SourceContractError):
        return SOURCE_CONTRACT_EXIT_CODE
    return CONFIGURATION_EXIT_CODE
