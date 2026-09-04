"""리포트 실행 단위(대상 선택·코호트·이어 돌기 표식·회차 대조)를 임시 레이크로 고정한다.

로컬 원본 레이크가 없어도 도는 테스트다. `<shard>/<공고 id>.xml.gz` 배치만 같으면 실행 경로가 같다.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

SCRIPTS_ROOT = Path(__file__).parents[2] / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from lake_report.render import render_markdown
from renormalize_lake_report import build_report, state_header

from .lake_report_support import detail_document, submission, write_lake_file

_NAMSAN = "153045"
_OTHER_ORGANIZATION = "111111"


def _lake_with_three_files(tmp_path: Path) -> Path:
    lake = tmp_path / "lake"
    write_lake_file(
        lake,
        "5000001",
        detail_document(
            bid_list=[
                submission(bid_rate="90.500", status="002", shipper="1", RNK="1"),
                submission(bid_rate="91.000", shipper="2", RNK="2"),
            ]
        ),
    )
    # 정규화만 실패한 관측이다. 원본 파싱은 됐으므로 기관 코드를 갖고 코호트에 남는다.
    write_lake_file(
        tmp_path / "lake", "5000002", detail_document(bid_list=[submission(bid_rate="90.2185")])
    )
    # 원본 파싱부터 실패한 관측이다. 기관 코드를 알 수 없어 어떤 코호트에도 속하지 못한다.
    write_lake_file(tmp_path / "lake", "5000003", b"<Root>")
    return lake


def test_기관을_좁힌_실행이_격리를_지우지_않고_기관_미상만_따로_센다(
    tmp_path: Path,
) -> None:
    lake = _lake_with_three_files(tmp_path)

    report = build_report(lake, calc_version="test", organization_code=_NAMSAN)

    assert report.sample_count == 2
    assert report.normalized == 1
    assert report.quarantined == 1
    assert report.excluded_unknown_organization == 1


def test_다른_기관으로_좁히면_표본이_비어도_제외_수는_남는다(tmp_path: Path) -> None:
    lake = _lake_with_three_files(tmp_path)

    report = build_report(
        lake, calc_version="test", organization_code=_OTHER_ORGANIZATION
    )

    assert report.sample_count == 0
    assert report.excluded_unknown_organization == 1


def test_레이크_전체_stat은_전수_실행에서만_계산한다(tmp_path: Path) -> None:
    lake = _lake_with_three_files(tmp_path)

    full = build_report(lake, calc_version="test")
    cohort = build_report(lake, calc_version="test", limit=2)

    assert full.lake_file_count == 3
    assert full.lake_latest_mtime is not None
    assert cohort.lake_file_count is None
    assert cohort.lake_latest_mtime is None
    assert "코호트 실행이라 생략" in render_markdown(cohort)


def test_이어_돌기_상태는_표식을_쓰고_같은_실행에서_그대로_재사용된다(
    tmp_path: Path,
) -> None:
    lake = _lake_with_three_files(tmp_path)
    state = tmp_path / "state.jsonl"

    first = build_report(lake, calc_version="test", state=state)
    second = build_report(lake, calc_version="test", state=state)

    header = json.loads(state.read_text(encoding="utf-8").splitlines()[0])
    assert header["header"] == state_header()
    assert first.sample_count == second.sample_count == 3
    assert first.normalized == second.normalized


def test_파서_버전이_다른_이어_돌기_상태는_조용히_쓰지_않고_멈춘다(
    tmp_path: Path,
) -> None:
    lake = _lake_with_three_files(tmp_path)
    state = tmp_path / "state.jsonl"
    build_report(lake, calc_version="test", state=state)
    lines = state.read_text(encoding="utf-8").splitlines()
    stale = {**state_header(), "parser_version": "eat-v1"}
    state.write_text(
        "\n".join([json.dumps({"header": stale}, ensure_ascii=False), *lines[1:]]),
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="parser_version"):
        build_report(lake, calc_version="test", state=state)


def test_계약_schema가_바뀐_이어_돌기_상태는_조용히_쓰지_않고_멈춘다(
    tmp_path: Path,
) -> None:
    lake = _lake_with_three_files(tmp_path)
    state = tmp_path / "state.jsonl"
    build_report(lake, calc_version="test", state=state)
    lines = state.read_text(encoding="utf-8").splitlines()
    stale = {**state_header(), "schema_sha256": "0" * 64}
    state.write_text(
        "\n".join([json.dumps({"header": stale}, ensure_ascii=False), *lines[1:]]),
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="schema_sha256"):
        build_report(lake, calc_version="test", state=state)


def test_관측_필드가_바뀐_이어_돌기_상태는_조용히_쓰지_않고_멈춘다(
    tmp_path: Path,
) -> None:
    lake = _lake_with_three_files(tmp_path)
    state = tmp_path / "state.jsonl"
    build_report(lake, calc_version="test", state=state)
    lines = state.read_text(encoding="utf-8").splitlines()
    header = state_header()
    observation_fields = header["observation_fields"]
    assert isinstance(observation_fields, list)
    stale = {**header, "observation_fields": observation_fields[:-1]}
    state.write_text(
        "\n".join([json.dumps({"header": stale}, ensure_ascii=False), *lines[1:]]),
        encoding="utf-8",
    )

    with pytest.raises(SystemExit, match="observation_fields"):
        build_report(lake, calc_version="test", state=state)


def test_표식이_없는_옛_이어_돌기_상태는_거부한다(tmp_path: Path) -> None:
    lake = _lake_with_three_files(tmp_path)
    state = tmp_path / "state.jsonl"
    build_report(lake, calc_version="test", state=state)
    lines = state.read_text(encoding="utf-8").splitlines()
    state.write_text("\n".join(lines[1:]), encoding="utf-8")

    with pytest.raises(SystemExit, match="표식이 없다"):
        build_report(lake, calc_version="test", state=state)


def test_회차_조사_대조가_일치와_불일치와_격리를_나눠_적는다(tmp_path: Path) -> None:
    lake = _lake_with_three_files(tmp_path)
    rounds_source = tmp_path / "rounds.json"
    rounds_source.write_text(
        json.dumps(
            [
                # 조사 파일에는 업체 정체성이 담긴 `bids` 배열이 있다. 대조는 이 셋만 읽는다.
                {"bidId": "5000001", "winRate": 90.5, "nBids": 2, "bids": ["열지 않는다"]},
                {"bidId": "5000002", "winRate": 90.219, "nBids": 1},
                {"bidId": "5000404", "winRate": 90.0, "nBids": 3},
            ]
        ),
        encoding="utf-8",
    )

    report = build_report(
        lake,
        calc_version="test",
        organization_code=_NAMSAN,
        rounds_source=rounds_source,
        rounds_organization_code=_NAMSAN,
    )

    assert report.rounds is not None
    assert report.rounds.listed == 3
    assert report.rounds.matched == 1
    assert report.rounds.mismatched == ()
    assert report.rounds.quarantined == ("5000002",)
    assert report.rounds.missing == ("5000404",)
    assert report.rounds.organization_rounds == 1
    assert "## 회차 조사 대조" in render_markdown(report)


def test_조사값과_다른_관측은_불일치로_남는다(tmp_path: Path) -> None:
    lake = _lake_with_three_files(tmp_path)
    rounds_source = tmp_path / "rounds.json"
    rounds_source.write_text(
        json.dumps([{"bidId": "5000001", "winRate": 88.0, "nBids": 2}]),
        encoding="utf-8",
    )

    report = build_report(lake, calc_version="test", rounds_source=rounds_source)

    assert report.rounds is not None
    assert report.rounds.matched == 0
    assert report.rounds.mismatched == ("5000001",)


def test_하한율별_분해가_리포트와_문서에_함께_남는다(tmp_path: Path) -> None:
    lake = tmp_path / "lake"
    write_lake_file(
        lake,
        "5000010",
        detail_document(
            info={"PLNPRCE_SUCBD_STD": "90"},
            bid_list=[
                submission(bid_rate="89.000", shipper="1"),
                submission(bid_rate="90.500", shipper="2"),
            ],
        ),
    )
    write_lake_file(
        lake,
        "5000011",
        detail_document(
            info={"PLNPRCE_SUCBD_STD": "88"},
            bid_list=[submission(bid_rate="89.000", shipper="1")],
        ),
    )
    write_lake_file(
        lake,
        "5000012",
        detail_document(
            info={"PLNPRCE_SUCBD_STD": ""},
            bid_list=[submission(bid_rate="89.000", shipper="1")],
        ),
    )

    report = build_report(lake, calc_version="test")

    assert {
        rate: (rounds, rows, below, share)
        for rate, rounds, rows, below, share in report.floor_rate_metrics
    } == {
        "90.000": (1, 2, 1, "50.000%"),
        "88.000": (1, 1, 0, "0.000%"),
        "하한율 미관측": (1, 1, 0, "0.000%"),
    }
    assert "### 하한율별 분해" in render_markdown(report)
