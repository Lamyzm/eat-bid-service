import argparse
from collections.abc import Sequence

COMMANDS = ("discover", "capture", "normalize", "validate", "project", "replay")
CONFIGURATION_EXIT_CODE = 64
DATA_QUARANTINED_EXIT_CODE = 65
SOURCE_THROTTLED_EXIT_CODE = 75
SOURCE_CONTRACT_EXIT_CODE = 76


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="eatbid")
    subcommands = parser.add_subparsers(dest="command", required=True)
    for name in COMMANDS:
        command = subcommands.add_parser(name)
        command.add_argument("--run-id", required=True)
        command.add_argument("--build-sha", required=True)
        command.add_argument("--parser-version", required=True)
        if name == "replay":
            command.add_argument("--publication-id", required=True)
            command.add_argument(
                "--observation-id", required=True, action="append", type=int
            )
            command.add_argument("--started-at", required=True)
            command.add_argument("--normalized-at", required=True)
            command.add_argument("--validated-at", required=True)
            command.add_argument("--activated-at", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    build_parser().parse_args(argv)
    return CONFIGURATION_EXIT_CODE


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
