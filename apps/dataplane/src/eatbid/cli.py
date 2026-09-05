"""모듈 책임: typed CLI 인수를 실제 application method와 안정된 exit code로 dispatch한다."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Callable, Mapping, Sequence
from datetime import datetime
from pathlib import Path
from types import TracebackType
from typing import Protocol, Self
from uuid import UUID

from eatbid.config import ApplicationSettings
from eatbid.core.build_identity import validate_build_sha
from eatbid.failure_report import render_failure
from eatbid.ingest.models import CapturedObservation
from eatbid.pipeline.collection_window import COLLECTION_MODES
from eatbid.pipeline.discover import DiscoveryResult

CONFIGURATION_EXIT_CODE = 64
DATA_QUARANTINED_EXIT_CODE = 65
SOURCE_THROTTLED_EXIT_CODE = 75
SOURCE_CONTRACT_EXIT_CODE = 76

# workflow 실패 파라미터와 재시도 정책이 이 이름에 묶여 있으므로 exit code와 짝을 바꾸지 않는다.
FAILURE_CATEGORIES: Mapping[int, str] = {
    CONFIGURATION_EXIT_CODE: "CONFIGURATION",
    DATA_QUARANTINED_EXIT_CODE: "DATA_QUARANTINED",
    SOURCE_THROTTLED_EXIT_CODE: "SOURCE_THROTTLED",
    SOURCE_CONTRACT_EXIT_CODE: "SOURCE_CONTRACT",
}


class CliApplication(Protocol):
    def __enter__(self) -> Self: ...
    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None: ...
    def discover(self, args: argparse.Namespace) -> object: ...
    def capture(self, args: argparse.Namespace) -> object: ...
    def normalize(self, args: argparse.Namespace) -> None: ...
    def validate(self, args: argparse.Namespace) -> None: ...
    def project(self, args: argparse.Namespace) -> None: ...
    def replay(self, args: argparse.Namespace) -> None: ...


CommandHandler = Callable[[argparse.Namespace, CliApplication], int]
ApplicationFactory = Callable[[ApplicationSettings], CliApplication]


def _handler(method_name: str) -> CommandHandler:
    def run(args: argparse.Namespace, application: CliApplication) -> int:
        result = getattr(application, method_name)(args)
        payload = _machine_result(method_name, result)
        if payload is not None:
            print(json.dumps(payload, sort_keys=True, separators=(",", ":")))
            result_dir = getattr(args, "result_dir", None)
            if result_dir is not None:
                _write_result_files(result_dir, payload)
        return 0

    return run


def _machine_result(method_name: str, result: object) -> dict[str, object] | None:
    if result is None:
        return None
    if method_name == "discover":
        if not isinstance(result, DiscoveryResult):
            raise TypeError("discover returned an invalid result")
        return {
            "detail_run_id": str(result.detail_run_id),
            "discovered_count": result.expected_count,
            "external_bid_ids": list(result.external_bid_ids),
            "manifest_sha256": result.discovered_manifest_sha256,
            "source_release_id": str(result.source_release_id),
        }
    if method_name == "capture":
        if not isinstance(result, CapturedObservation):
            raise TypeError("capture returned an invalid result")
        return {
            "content_sha256": result.content_sha256,
            "observation_id": result.observation_id,
        }
    return None


def _write_result_files(result_dir: Path, payload: Mapping[str, object]) -> None:
    """왜: workflow 실행기는 stdout이 아니라 파일에서 output parameter를 읽으므로 machine result의
    key마다 파일 하나를 둔다. 목록 값은 JSON 배열이라 그대로 fan-out 입력이 된다."""
    result_dir.mkdir(parents=True, exist_ok=True)
    for key, value in payload.items():
        text = (
            json.dumps(value, separators=(",", ":"))
            if isinstance(value, list)
            else str(value)
        )
        (result_dir / key).write_text(text, encoding="utf-8")


COMMAND_HANDLERS: Mapping[str, CommandHandler] = {
    name: _handler(name)
    for name in ("discover", "capture", "normalize", "validate", "project", "replay")
}


def _build_sha(value: str) -> str:
    try:
        return validate_build_sha(value)
    except ValueError as error:
        raise argparse.ArgumentTypeError(str(error)) from None


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
    command.add_argument("--build-sha", required=True, type=_build_sha)
    command.add_argument("--parser-version", required=True)
    command.add_argument("--result-dir", type=Path, default=None)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eatbid")
    subcommands = parser.add_subparsers(dest="command", required=True)
    commands = {name: subcommands.add_parser(name) for name in COMMAND_HANDLERS}
    for command in commands.values():
        _common(command)

    discover = commands["discover"]
    discover.add_argument("--detail-run-id", required=True, type=UUID)
    # 모드가 창을 정한다. 날짜는 backfill에서만 받고 예약 모드에서는 --as-of의 서울 날짜로 번역한다.
    discover.add_argument("--mode", required=True, choices=COLLECTION_MODES)
    discover.add_argument("--release-name", required=True)
    discover.add_argument("--as-of", required=True, type=_aware_datetime)
    discover.add_argument("--started-at", required=True, type=_aware_datetime)
    discover.add_argument("--completed-at", required=True, type=_aware_datetime)
    discover.add_argument("--start-date", default="")
    discover.add_argument("--end-date", default="")
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
        category = FAILURE_CATEGORIES.get(exit_code, "CONFIGURATION")
        # 왜: 카테고리 한 단어로는 권한 부재와 연결 시간 초과를 구분할 수 없어 원인을 pod 이벤트로
        # 역추적해야 했다. 예외 클래스와 비밀값을 지운 메시지를 같은 줄에 남긴다.
        print(
            render_failure(error, category=category, args=args, settings=settings),
            file=sys.stderr,
        )
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
