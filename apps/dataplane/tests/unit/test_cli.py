from eatbid.cli import build_parser, exit_code_for_error, main
from eatbid.pipeline.normalize import DataQuarantinedError


def test_cli_exposes_pipeline_commands() -> None:
    parser = build_parser()
    action = next(action for action in parser._actions if action.dest == "command")

    assert set(action.choices) == {
        "discover",
        "capture",
        "normalize",
        "validate",
        "project",
        "replay",
    }


def test_unwired_command_returns_configuration_exit_code() -> None:
    assert main(
        [
            "discover",
            "--run-id",
            "run-123",
            "--build-sha",
            "abc123",
            "--parser-version",
            "v1",
        ]
    ) == 64


def test_data_quarantine_has_its_dedicated_typed_exit_code() -> None:
    assert exit_code_for_error(DataQuarantinedError(7, "invalid source payload")) == 65
