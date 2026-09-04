"""`lake_report.observe`의 관측 규칙과 `lake_report.render`의 절 구성을 레이크 없이 고정한다.

파생 지표의 정의(무엇을 무엇으로 나눴는가)와 결론 절 보존은 문서의 의미를 정하므로 여기서 고정한다.
"""

from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS_ROOT = Path(__file__).parents[2] / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from lake_report.observe import OBSERVED_BID_RATE_CEILING, draw_average, observe_file
from lake_report.render import CONCLUSION_MARKER, existing_conclusion

from eatbid.source.eat import wire_text
from eatbid.source.eat.xml import parse_nexacro

from .lake_report_support import detail_document, submission, write_lake_file


def test_리포트가_복제한_사정률_상한은_파서_상한과_같다() -> None:
    """다른 상한 넷은 생성 JSON Schema에서 읽지만 이것만 정규식이라 손으로 복제한다.

    두 값이 갈리면 리포트가 조용히 틀린 격리 판정을 낸다. 갈라지는 순간 여기서 멈춘다.
    """
    assert OBSERVED_BID_RATE_CEILING == wire_text._OBSERVED_BID_RATE_MAXIMUM


def test_명단_행이_하한_미만과_일이등_격차로_다시_세어진다(tmp_path: Path) -> None:
    payload = detail_document(
        info={"PLNPRCE_SUCBD_STD": "90"},
        bid_list=[
            submission(bid_rate="89.000", shipper="1"),
            submission(bid_rate="90.500", shipper="2", status="002", RNK="1"),
            submission(bid_rate="91.000", shipper="3", RNK="2"),
        ],
    )
    path = write_lake_file(tmp_path, "5669410", payload)

    observation = observe_file(str(path))

    assert observation.normalized
    assert observation.floor_rate == "90.000"
    assert observation.below_floor_rows == 1
    assert observation.roster_rows == 3
    # 격차는 하한 이상 투찰만 정렬해 최저 둘의 차다. 하한 미만인 89.000은 분모에도 분자에도 없다.
    assert observation.runner_up_gap == "0.500"
    assert observation.award_rate == "90.500"
    assert observation.award_below_floor is False


def test_하한율이_없으면_하한_미만을_만들지_않고_전_행을_유효로_본다(
    tmp_path: Path,
) -> None:
    payload = detail_document(
        info={"PLNPRCE_SUCBD_STD": ""},
        bid_list=[
            submission(bid_rate="80.000", shipper="1"),
            submission(bid_rate="90.500", shipper="2"),
        ],
    )
    path = write_lake_file(tmp_path, "5669411", payload)

    observation = observe_file(str(path))

    assert observation.floor_rate is None
    assert observation.below_floor_rows == 0
    assert observation.runner_up_gap == "10.500"


def test_유한하지_않은_사정률은_그_관측만_격리하고_실행을_멈추지_않는다(
    tmp_path: Path,
) -> None:
    payload = detail_document(bid_list=[submission(bid_rate="nan")])
    path = write_lake_file(tmp_path, "5669412", payload)

    observation = observe_file(str(path))

    assert observation.normalized is False
    assert observation.quarantine_reason is not None
    assert observation.max_bid_rate is None


def test_격리_사유는_한_줄이고_파이프를_표에서_이스케이프한다(tmp_path: Path) -> None:
    payload = detail_document(bid_list=[submission(bid_rate="90.2185")])
    path = write_lake_file(tmp_path, "5669413", payload)

    observation = observe_file(str(path))

    assert observation.normalized is False
    assert observation.quarantine_reason is not None
    assert "\n" not in observation.quarantine_reason
    assert "|" not in observation.quarantine_reason.replace("\\|", "")
    # 계약 상한이 문장 끝에 오므로 중간에서 잘리면 독자가 잘린 숫자를 상한으로 읽는다.
    assert observation.quarantine_reason.endswith("at scale 3")


def test_추첨_평균은_예정가격이_쓴_자릿수로_반올림해_대조한다() -> None:
    integral = parse_nexacro(
        detail_document(
            info={"ELCTRN_BID_PLNPRC": "101"},
            p_list=[
                {"CMNM_PLNPRC": "100", "CHC_YN": "Y"},
                {"CMNM_PLNPRC": "101", "CHC_YN": "Y"},
            ],
        ),
        require_ds_info=True,
    )
    fractional = parse_nexacro(
        detail_document(
            info={"ELCTRN_BID_PLNPRC": "100.51"},
            p_list=[
                {"CMNM_PLNPRC": "100.505", "CHC_YN": "Y"},
                {"CMNM_PLNPRC": "100.510", "CHC_YN": "Y"},
            ],
        ),
        require_ds_info=True,
    )

    # 정수로 오는 회차는 .50을 올린다(100.5 → 101). 계약 Money의 자릿수 2로 검사하면 위반이 된다.
    assert draw_average(integral, integral.datasets["ds_info"][0]) == (True, False)
    assert draw_average(fractional, fractional.datasets["ds_info"][0]) == (True, False)


def test_선택된_후보가_없으면_평균을_검사하지_않는다() -> None:
    parsed = parse_nexacro(
        detail_document(
            info={"ELCTRN_BID_PLNPRC": "100"},
            p_list=[{"CMNM_PLNPRC": "100", "CHC_YN": "N"}],
        ),
        require_ds_info=True,
    )

    assert draw_average(parsed, parsed.datasets["ds_info"][0]) == (False, False)


def test_사람이_쓴_결론_절은_재실행에서도_그대로_이어붙는다(tmp_path: Path) -> None:
    output = tmp_path / "report.md"
    output.write_text(
        f"# 옛 표\n\n낡은 숫자{CONCLUSION_MARKER} (사람이 쓴 절)\n\n판단은 남는다.\n",
        encoding="utf-8",
    )

    conclusion = existing_conclusion(output)

    assert conclusion.startswith(CONCLUSION_MARKER)
    assert "판단은 남는다." in conclusion
    assert "낡은 숫자" not in conclusion


def test_결론_절이_없거나_파일이_없으면_빈_문자열이다(tmp_path: Path) -> None:
    missing = tmp_path / "none.md"
    without = tmp_path / "without.md"
    without.write_text("# 표만 있는 문서\n", encoding="utf-8")

    assert existing_conclusion(missing) == ""
    assert existing_conclusion(without) == ""
