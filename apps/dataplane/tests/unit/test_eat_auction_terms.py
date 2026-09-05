"""`ds_info`가 표시한 공고 조건(하한율·예정가격 방식·낙찰자 결정 방법) 파싱 명세."""

from __future__ import annotations

from pathlib import Path

from eatbid.source.eat.auction_terms import parse_auction_terms
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"


def _parsed(name: str) -> ParsedNexacro:
    return parse_nexacro((FIXTURES / name).read_bytes(), require_ds_info=True)


def test_하한율은_소수_세_자리_비율로_관측된다() -> None:
    terms = parse_auction_terms(
        {
            "PLNPRCE_SUCBD_STD": "90",
            "PLNPRC_TYPE_CD": "002",
            "PLNPRCE_TYPE_NM": "복수예정가격",
        }
    )

    assert terms.floor_rate is not None
    assert terms.floor_rate.value == "90.000"
    assert terms.planned_price_method is not None
    assert terms.planned_price_method.code == "002"
    assert terms.planned_price_method.code_scheme == "eat:planned-price-type"


def test_낙찰자_결정_방법은_ds_info의_코드_column에서_읽고_표시_문장은_라벨로_남긴다() -> None:
    terms = parse_auction_terms(
        {
            "SUCBID_DCSN_MTH_CD": "003",
            "SUCBD_DECISION_MTHD_NM": "예정가격의 [90]%이상 입찰가 중 최저가 낙찰",
        }
    )

    assert terms.award_method is not None
    assert terms.award_method.code == "003"
    assert terms.award_method.code_scheme == "eat:award-method"
    assert terms.award_method.label is not None
    assert terms.award_method.label.root == "예정가격의 [90]%이상 입찰가 중 최저가 낙찰"


def test_실제_상세_응답에서도_낙찰자_결정_방법_코드가_관측된다() -> None:
    parsed = _parsed("bid-detail-roster.xml")

    terms = parse_auction_terms(parsed.datasets["ds_info"][0])

    assert terms.award_method is not None
    assert terms.award_method.code == "003"


def test_낙찰자_결정_방법은_코드가_없으면_표시_문장을_코드_자리에_넣지_않는다() -> None:
    terms = parse_auction_terms(
        {"SUCBD_DECISION_MTHD_NM": "예정가격의 [90]%이상 입찰가 중 최저가 낙찰"}
    )

    assert terms.award_method is None
