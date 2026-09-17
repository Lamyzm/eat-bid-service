from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

import pytest

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
    assert first.source_status.code_scheme == "eat:bid-status"
    assert first.source_status.label is not None
    assert first.source_status.label.root == "낙찰"
    assert first.supplier_account.account_code.code_scheme == "eat:supplier-account"
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
    assert withdrawn.withdrawal_flag.code_scheme == "eat:withdrawal-flag"


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
    # 계약 atom `ObservedBidRateText`의 정수부 12자리 경계다. 파서와 계약이 같은 자리에서 끊어야
    # 한쪽만 통과하는 값이 생기지 않는다.
    assert _bid_rate("999999999999.999") == "999999999999.999"


def test_계약_정수부_열세_자리_사정률은_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(
                    SAJEONG_PCT="1000000000000.000",
                    BID_CALC_AMT="1000",
                    BID_STT="005",
                    SHIPPER_CD="1",
                ),
            )
        )


def test_음수_사정률도_관측값_그대로_싣는다() -> None:
    # 2026-03 창 명단 3건이 -2507.667·-3938.779·-9200.855였다. 비음수로 닫으면 그 6건이 창 전체 16,469건의
    # 발행을 막는다(EAT-235). 뜻은 모르고 그 판단은 분석 단계가 한다(ADR 0053).
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

    assert _bid_rate("-2507.667") == "-2507.667"
    assert _bid_rate("-1") == "-1.000"
    # "-0"은 0과 같은 값이라 부호 없는 0으로 적는다 — 계약 정규식도 부호 있는 0을 받지 않는다.
    assert _bid_rate("-0") == "0.000"
    # 크기는 양수와 같은 상한이다.
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        _bid_rate("-1000000000000.000")


def test_계약보다_정밀한_사정률은_반올림하지_않고_거부한다() -> None:
    with pytest.raises(ValueError, match="SAJEONG_PCT"):
        parse_bid_roster(
            _detail(
                "ds_bidList",
                _row(
                    SAJEONG_PCT="90.2185",
                    BID_CALC_AMT="1000",
                    BID_STT="005",
                    SHIPPER_CD="1",
                ),
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
                _row(
                    SAJEONG_PCT="90.100",
                    BID_CALC_AMT="1000",
                    BID_STT="005",
                    SHIPPER_CD="1",
                    DRAW_NO="7, 삼",
                ),
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
        _row(
            SAJEONG_PCT="90.100",
            BID_CALC_AMT="1000",
            BID_STT="002",
            SHIPPER_CD="1",
            RNK="1",
        ),
        _row(
            SAJEONG_PCT="90.200",
            BID_CALC_AMT="2000",
            BID_STT="002",
            SHIPPER_CD="2",
            RNK="2",
        ),
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
    average = (sum(chosen) / len(chosen)).quantize(Decimal(1), rounding=ROUND_HALF_UP)
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
    assert first_announcement.source_status.code_scheme == "eat:attempt-status"


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


def test_생성된_관측_사정률_모델은_음수를_받고_부호_있는_0은_거부한다() -> None:
    # 생성 모델의 정규식은 pydantic의 Rust regex로 컴파일된다 — lookaround가 있으면 모델 로드 자체가 죽는다
    # (2026-09-16 smoke 실측). 여기서 실제로 생성자를 불러 그 정규식이 살아 있는지도 함께 본다.
    from pydantic import ValidationError

    from eatbid.generated.ingestion_v2 import ObservedBidRate

    assert (
        ObservedBidRate(value="-2507.667", unit="percentage-points").value
        == "-2507.667"
    )
    assert ObservedBidRate(value="-0.001", unit="percentage-points").value == "-0.001"
    assert ObservedBidRate(value="0.000", unit="percentage-points").value == "0.000"
    for rejected in ("-0.000", "-1000000000000.000", "--1.000", "1.00"):
        with pytest.raises(ValidationError):
            ObservedBidRate(value=rejected, unit="percentage-points")


def _roster_row(**overrides: str) -> str:
    columns = {
        "SHIPPER_CD": "S001",
        "BID_STT": "002",
        "BID_CALC_AMT": "6101000",
        "SAJEONG_PCT": "90.218",
        "EFT_ALL_AMT": "6101000",
        **overrides,
    }
    return _row(**columns)


def test_계약_밖_유효금액은_그_칸만_모름이고_줄과_레코드는_산다() -> None:
    """왜: 2026-09-17 명단 104줄 중 한 줄의 `3978476.348`이 원화 scale 2를 넘어 그 창 16,684건의 발행을
    막았다. 이 칸은 부재를 이미 허용하고 분석이 부재와 계약 밖을 다르게 다루지 않으므로 모름으로
    내린다(ADR 0056 결정 1)."""
    parsed = _detail(
        "ds_bidList",
        _roster_row(EFT_ALL_AMT="3978476.348"),
        _roster_row(SHIPPER_CD="S002"),
    )
    notes: list[str] = []

    roster = parse_bid_roster(parsed, notes=notes)

    assert len(roster.submissions) == 2
    첫줄 = roster.submissions[0]
    assert 첫줄.effective_amount is None
    # 같은 줄의 나머지 관측은 그대로 살아 있다 — 모름이 된 것은 그 칸 하나뿐이다.
    assert 첫줄.amount.amount == "6101000.00"
    assert 첫줄.bid_rate.value == "90.218"
    assert roster.submissions[1].effective_amount is not None
    # 관용은 조용하지 않다(결정 3).
    assert len(notes) == 1
    assert "EFT_ALL_AMT" in notes[0]


def test_정체성과_필수_사실은_관용을_받지_않는다() -> None:
    """왜: 그 칸이 틀리면 이 줄이 무엇에 대한 관측인지 말할 수 없다. 모름으로 두면 우리가 만든 줄이
    된다(ADR 0056 결정 2)."""
    for 칸, 값 in (
        ("BID_CALC_AMT", "3978476.348"),
        ("SAJEONG_PCT", "9999999999999.1"),
    ):
        parsed = _detail("ds_bidList", _roster_row(**{칸: 값}))

        with pytest.raises(ValueError):
            parse_bid_roster(parsed, notes=[])


def test_계약_밖_칸이_없으면_사유도_남지_않는다() -> None:
    parsed = _detail("ds_bidList", _roster_row())
    notes: list[str] = []

    roster = parse_bid_roster(parsed, notes=notes)

    assert roster.submissions[0].effective_amount is not None
    assert notes == []
