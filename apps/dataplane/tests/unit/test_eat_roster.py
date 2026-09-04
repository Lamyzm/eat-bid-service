from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import pytest

from eatbid.source.eat.auction_terms import parse_auction_terms
from eatbid.source.eat.lineage import parse_lineage
from eatbid.source.eat.reserve_price import parse_reserve_price_draw
from eatbid.source.eat.roster import parse_award_decision, parse_bid_roster
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"
NS = "http://www.nexacroplatform.com/platform/dataset"


def _parsed(name: str) -> ParsedNexacro:
    return parse_nexacro((FIXTURES / name).read_bytes(), require_ds_info=True)


def _row(**columns: str) -> str:
    body = "".join(f'<Col id="{key}">{value}</Col>' for key, value in columns.items())
    return f"<Row>{body}</Row>"


def _detail(dataset: str, *rows: str, **info: str) -> ParsedNexacro:
    info_columns = {
        "BID_NM": "비식별 급식 식재료 구매",
        "ELCTRN_BID_STT_NM": "낙찰",
        "PURR_CD": "1",
        "PURR_NM": "비식별 구매기관",
        **info,
    }
    document = (
        f'<Root xmlns="{NS}">'
        f'<Dataset id="ds_info"><Rows>{_row(**info_columns)}</Rows></Dataset>'
        f'<Dataset id="{dataset}"><Rows>{"".join(rows)}</Rows></Dataset>'
        f"</Root>"
    )
    return parse_nexacro(document.encode("utf-8"), require_ds_info=True)


def test_명단_행이_사정률과_금액과_판정_코드를_그대로_싣는다() -> None:
    roster = parse_bid_roster(_parsed("bid-detail-roster.xml"))

    assert len(roster.submissions) == 7
    assert roster.source_roster_size is not None
    assert roster.source_roster_size.root == 85
    first = roster.submissions[0]
    assert first.bid_rate.value == "90.218"
    assert first.amount.amount == "6101000.00"
    assert first.source_status.code == "002"
    assert first.source_status.code_scheme == "eat:BID_STT"
    assert first.source_status.label is not None
    assert first.source_status.label.root == "낙찰"
    assert first.supplier_account.account_code.code_scheme == "eat:SHIPPER_CD"
    assert first.supplier_account.source_system == "eat"
    assert [number.root for number in first.draw_numbers] == ["7", "3"]
    assert first.submitted_at is not None
    assert first.submitted_at.root == "2025-11-19T09:14:39Z"


def test_소스에_없는_무효_판정을_만들지_않고_코드를_그대로_통과시킨다() -> None:
    roster = parse_bid_roster(_parsed("bid-detail-rebid.xml"))

    withdrawn = roster.submissions[1]
    assert withdrawn.bid_rate.value == "89.626"
    assert withdrawn.source_status.code == "005"
    assert withdrawn.withdrawal_flag is not None
    assert withdrawn.withdrawal_flag.code == "Y"
    assert withdrawn.withdrawal_flag.code_scheme == "eat:WITHDRAWAL_YN"


def test_실측에_없던_판정_코드도_열거로_막지_않는다() -> None:
    roster = parse_bid_roster(
        _detail(
            "ds_bidList",
            _row(
                SAJEONG_PCT="90.100",
                BID_CALC_AMT="1000",
                BID_STT="999",
                BID_STT_NM="알 수 없는 판정",
                SHIPPER_CD="1",
            ),
        )
    )

    assert roster.submissions[0].source_status.code == "999"


def test_사정률의_짧은_소수를_잘라내지_않고_세_자리로_맞춘다() -> None:
    roster = parse_bid_roster(
        _detail(
            "ds_bidList",
            _row(
                SAJEONG_PCT="91.87",
                BID_CALC_AMT="6212700",
                BID_STT="005",
                SHIPPER_CD="200492",
                RNK="83",
            ),
        )
    )

    assert roster.submissions[0].bid_rate.value == "91.870"


def test_예정가격을_넘는_사정률과_단가입찰_총액도_격리하지_않고_싣는다() -> None:
    def _bid_rate(value: str) -> str:
        roster = parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(
                    SAJEONG_PCT=value,
                    BID_CALC_AMT="1000",
                    BID_STT="005",
                    SHIPPER_CD="1",
                ),
            )
        )
        return roster.submissions[0].bid_rate.value

    assert _bid_rate("101.975") == "101.975"
    assert _bid_rate("44477738.05") == "44477738.050"


def test_음수_사정률은_관측_상한을_없애도_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(SAJEONG_PCT="-1.000", BID_CALC_AMT="1000", BID_STT="005",
                     SHIPPER_CD="1"),
            )
        )


def test_계약보다_정밀한_사정률은_반올림하지_않고_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(SAJEONG_PCT="90.2185", BID_CALC_AMT="1000", BID_STT="005",
                     SHIPPER_CD="1"),
            )
        )


def test_사정률이_없는_명단_행은_해석하지_않고_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(BID_CALC_AMT="6212700", BID_STT="005", SHIPPER_CD="200492"),
            )
        )


def test_명단_블록이_없으면_빈_명단이지_실패가_아니다() -> None:
    roster = parse_bid_roster(_parsed("bid-detail-no-roster.xml"))

    assert roster.submissions == []
    assert roster.source_roster_size is None


def test_추첨번호가_십진수가_아니면_거부한다() -> None:
    with pytest.raises(ValueError, match="DRAW_NO"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(SAJEONG_PCT="90.100", BID_CALC_AMT="1000", BID_STT="005",
                     SHIPPER_CD="1", DRAW_NO="7, 삼"),
            )
        )


def test_낙찰은_원본_판정_코드로_고르고_이등은_원본_순위로_고른다() -> None:
    parsed = _parsed("bid-detail-roster.xml")
    roster = parse_bid_roster(parsed)

    award = parse_award_decision(parsed, roster)

    assert award is not None
    assert award.awarded_rate.value == "90.218"
    assert award.awarded_amount.amount == "6101000.00"
    assert award.awarded_at is not None
    assert award.awarded_at.root == "2025-11-19T15:00:00Z"
    assert award.runner_up_rate is not None
    assert award.runner_up_rate.value == "90.382"
    assert award.supplier_account.account_code.code == "200000"


def test_명단이_비면_낙찰_판정도_없다() -> None:
    parsed = _parsed("bid-detail-no-roster.xml")

    assert parse_award_decision(parsed, parse_bid_roster(parsed)) is None


def test_낙찰_판정이_둘_이상이면_해석하지_않고_거부한다() -> None:
    parsed = _detail(
        "ds_bidList",
        _row(SAJEONG_PCT="90.100", BID_CALC_AMT="1000", BID_STT="002", SHIPPER_CD="1",
             RNK="1"),
        _row(SAJEONG_PCT="90.200", BID_CALC_AMT="2000", BID_STT="002", SHIPPER_CD="2",
             RNK="2"),
    )
    roster = parse_bid_roster(parsed)

    with pytest.raises(ValueError, match="single award"):
        parse_award_decision(parsed, roster)


def test_추첨_후보_넷의_평균이_관측된_예정가격과_같다() -> None:
    parsed = _parsed("bid-detail-roster.xml")

    draw = parse_reserve_price_draw(parsed)

    assert len(draw.candidates) == 15
    chosen = [
        Decimal(candidate.amount.amount)
        for candidate in draw.candidates
        if candidate.chosen.code == "Y"
    ]
    assert len(chosen) == 4
    average = (sum(chosen) / len(chosen)).quantize(
        Decimal(1), rounding=ROUND_HALF_UP
    )
    assert average == Decimal(parsed.datasets["ds_info"][0]["ELCTRN_BID_PLNPRC"])


def test_기초금액_대비_배율이_일을_넘어도_관측_그대로_싣는다() -> None:
    draw = parse_reserve_price_draw(_parsed("bid-detail-roster.xml"))

    ratios = [candidate.ratio.value for candidate in draw.candidates]
    assert ratios[0] == "0.971700"
    assert ratios[3] == "1.019400"
    assert max(ratios) == "1.021800"


def test_추첨_후보_순번이_겹치면_거부한다() -> None:
    parsed = _detail(
        "ds_pList",
        _row(CMNM_PLNPRC_SN="1", CMNM_PLNPRC_RT="0.97", CMNM_PLNPRC="1", CHC_YN="Y"),
        _row(CMNM_PLNPRC_SN="1", CMNM_PLNPRC_RT="0.98", CMNM_PLNPRC="2", CHC_YN="N"),
    )

    with pytest.raises(ValueError, match="CMNM_PLNPRC_SN"):
        parse_reserve_price_draw(parsed)


def test_후보_순번은_추첨번호와_같은_source_code로_선행_0을_보존한다() -> None:
    parsed = _detail(
        "ds_pList",
        _row(CMNM_PLNPRC_SN="07", CMNM_PLNPRC_RT="0.97", CMNM_PLNPRC="1", CHC_YN="Y"),
    )

    draw = parse_reserve_price_draw(parsed)

    assert draw.candidates[0].sequence == "07"


def test_추첨번호가_후보_순번_집합_안에_있다() -> None:
    parsed = _parsed("bid-detail-roster.xml")

    roster = parse_bid_roster(parsed)
    draw = parse_reserve_price_draw(parsed)

    sequences = {candidate.sequence for candidate in draw.candidates}
    drawn = {
        number.root
        for submission in roster.submissions
        for number in submission.draw_numbers
    }
    assert drawn <= sequences


def test_재입찰_사슬은_원본_id로만_잇고_공고번호_접미사를_읽지_않는다() -> None:
    parsed = _parsed("bid-detail-rebid.xml")

    lineage = parse_lineage(parsed, parsed.datasets["ds_info"][0])

    assert lineage.parent_external_bid_id is not None
    assert lineage.parent_external_bid_id.root == "5306354"
    assert [link.external_bid_id for link in lineage.links] == [
        "5306521",
        "5306354",
        "5301243",
    ]
    assert all(not hasattr(link, "round_number") for link in lineage.links)
    first_announcement = lineage.links[2]
    assert first_announcement.display_bid_number is not None
    assert first_announcement.display_bid_number.root == "E230918-187847-0"
    assert first_announcement.source_status is not None
    assert first_announcement.source_status.code == "009"
    assert first_announcement.source_status.code_scheme == "eat:ETN_BID_STT"


def test_사슬에_같은_공고_id가_두_번_나오면_거부한다() -> None:
    parsed = _detail(
        "ds_bidHistory",
        _row(ETN_BID_ID="5306521", ETN_BID_STT="007"),
        _row(ETN_BID_ID="5306521", ETN_BID_STT="009"),
    )

    with pytest.raises(ValueError, match="ETN_BID_ID"):
        parse_lineage(parsed, parsed.datasets["ds_info"][0])


def test_사슬_블록이_없으면_빈_사슬이고_직전_차수도_없다() -> None:
    parsed = _parsed("bid-detail-no-roster.xml")

    lineage = parse_lineage(parsed, parsed.datasets["ds_info"][0])

    assert lineage.links == []
    assert lineage.parent_external_bid_id is None


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
    assert terms.planned_price_method.code_scheme == "eat:PLNPRC_TYPE_CD"


def test_낙찰자_결정_방법은_코드가_없으면_표시_문장을_코드_자리에_넣지_않는다() -> None:
    terms = parse_auction_terms(
        {"SUCBD_DECISION_MTHD_NM": "예정가격의 [90]%이상 입찰가 중 최저가 낙찰"}
    )

    assert terms.award_method is None
