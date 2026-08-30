import pytest

from eatbid.cli import build_parser, exit_code_for_error, main
from eatbid.pipeline.normalize import DataQuarantinedError


def test_cli가_pipeline_commands을_노출한다() -> None:
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


def test_unwired_command가_configuration_exit_code을_반환한다() -> None:
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


def test_replay_cli가_모든_external_identities_및_stage_timestamps을_요구한다() -> None:
    parser = build_parser()
    common = [
        "replay",
        "--run-id",
        "00000000-0000-0000-0000-000000000001",
        "--build-sha",
        "a" * 64,
        "--parser-version",
        "eat-v1",
    ]
    with pytest.raises(SystemExit):
        parser.parse_args(common)

    parsed = parser.parse_args(
        common
        + [
            "--publication-id",
            "00000000-0000-0000-0000-000000000002",
            "--observation-id",
            "7",
            "--observation-id",
            "3",
            "--started-at",
            "2026-08-29T05:00:00Z",
            "--normalized-at",
            "2026-08-29T05:01:00Z",
            "--validated-at",
            "2026-08-29T05:02:00Z",
            "--activated-at",
            "2026-08-29T05:03:00Z",
        ]
    )

    assert parsed.publication_id.endswith("2")
    assert parsed.observation_id == [7, 3]


def test_data_quarantine는_its_dedicated_typed_exit_code을_갖는다() -> None:
    assert exit_code_for_error(DataQuarantinedError(7, "invalid source payload")) == 65


def test_actual_eat_list_contract_error가_to_exit_76을_매핑한다() -> None:
    from eatbid.errors import SourceContractError
    from eatbid.source.eat.normalize import parse_bid_list_page

    payload = (
        b'<Root xmlns="http://www.nexacroplatform.com/platform/dataset">'
        b'<Dataset id="ds_list"><Rows><Row>'
        b'<Col id="TOT_CNT">-1</Col><Col id="ETN_BID_ID">1</Col>'
        b"</Row></Rows></Dataset></Root>"
    )

    try:
        parse_bid_list_page(payload)
    except SourceContractError as error:
        assert exit_code_for_error(error) == 76
    else:  # pragma: no cover - the assertion documents the required error boundary
        raise AssertionError("invalid TOT_CNT must raise SourceContractError")
