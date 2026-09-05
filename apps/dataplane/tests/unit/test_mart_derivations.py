"""남산초 조사 자료의 실측값으로 mart 파생 계산의 정의를 고정한다.

이 파일이 읽는 것은 금액과 비율뿐이다. 같은 파일에 있는 사업자번호·업체명은 읽지 않는다(AGENTS 2).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from eatbid.mart.derivations import (
    DISTRIBUTION_BIN_WIDTH,
    awarded_bid_rate,
    below_day_floor_count,
    day_floor_amount,
    day_floor_bid_rate,
    distribution_bin_lower,
    opened_month_kst,
    withdrawal_cohort_age_days,
)

_ROUNDS_FILE = (
    Path(__file__).resolve().parents[4]
    / "docs"
    / "product"
    / "decision-screen-v2"
    / "design-generators"
    / "namsan.json"
)


def _rounds() -> list[dict[str, object]]:
    return json.loads(_ROUNDS_FILE.read_text(encoding="utf-8"))


def _decimal(value: object) -> Decimal:
    return Decimal(str(value))


def test_그날_하한의_투찰률_축_번역이_조사_자료의_실효하한과_소수_넷째_자리까지_같다() -> None:
    rounds = _rounds()
    assert len(rounds) >= 90, "조사 자료의 회차가 충분히 있어야 대조가 의미를 갖는다"

    for entry in rounds:
        translated = day_floor_bid_rate(
            floor_rate=_decimal(entry["floorRate"]),
            planned_amount=_decimal(entry["plannedPrice"]),
            base_amount=_decimal(entry["basePrice"]),
        )
        assert translated == _decimal(entry["effFloor"]), entry["bidId"]


def test_하한_미만은_사정률_축에서_세고_투찰률_축과_분모가_다르다() -> None:
    axes_differ = 0
    for entry in _rounds():
        floor_rate = _decimal(entry["floorRate"])
        # 무효 상단은 하한율보다 낮고 낙찰 사정률은 하한율 이상이다. 둘 다 사정률 축의 값이다.
        # 하한 미만이 한 곳도 없던 회차에는 무효 상단이 없다. 없음을 0으로 메우지 않는다.
        if entry["maxInvalid"] is not None:
            assert _decimal(entry["maxInvalid"]) < floor_rate, entry["bidId"]
        assert _decimal(entry["winRate"]) >= floor_rate, entry["bidId"]
        # 같은 축이라면 낙찰자가 그날 하한 아래에 있다는 뜻이 되어 모순이다.
        if _decimal(entry["winRate"]) < _decimal(entry["effFloor"]):
            axes_differ += 1

    assert axes_differ > 0, "두 축이 다르다는 증거가 조사 자료에 있어야 한다"


def test_하한_미만_수는_부등식으로만_세고_반올림을_거치지_않는다() -> None:
    rates = (Decimal("89.999"), Decimal("90.000"), Decimal("90.001"), Decimal("88.500"))

    assert below_day_floor_count(rates, floor_rate=Decimal("90.000")) == 2
    assert below_day_floor_count(rates, floor_rate=Decimal("88.000")) == 0
    assert below_day_floor_count((), floor_rate=Decimal("90.000")) == 0


def test_그날_하한_금액은_내림한다() -> None:
    # 올림하면 이 금액에 딱 맞춘 투찰 하나가 하한 미만이 된다.
    assert day_floor_amount(
        floor_rate=Decimal("90.000"), planned_amount=Decimal(6762461)
    ) == Decimal("6086214.90")
    assert day_floor_amount(
        floor_rate=Decimal("90.000"), planned_amount=Decimal("3014528.11")
    ) == Decimal("2713075.29")


def test_낙찰_사정률도_같은_투찰률_축으로_옮긴다() -> None:
    assert awarded_bid_rate(
        assessment_rate=Decimal("90.218"),
        planned_amount=Decimal(6762461),
        base_amount=Decimal(6913400),
    ) == Decimal("88.2483")


def test_기초금액이_0이면_축을_옮기지_않고_거부한다() -> None:
    with pytest.raises(ValueError):
        day_floor_bid_rate(
            floor_rate=Decimal("90.000"),
            planned_amount=Decimal(1000),
            base_amount=Decimal(0),
        )


def test_호가창_칸은_반개구간이다() -> None:
    assert distribution_bin_lower(Decimal("90.010")) == Decimal("90.010")
    assert distribution_bin_lower(Decimal("90.019")) == Decimal("90.010")
    assert distribution_bin_lower(Decimal("90.020")) == Decimal("90.020")
    assert DISTRIBUTION_BIN_WIDTH == Decimal("0.010")


def test_달_경계는_개찰_시각의_KST_달이다() -> None:
    assert opened_month_kst(datetime(2025, 12, 31, 15, 0, tzinfo=UTC)).isoformat() == "2026-01-01"
    assert opened_month_kst(datetime(2025, 12, 31, 14, 59, tzinfo=UTC)).isoformat() == "2025-12-01"

    with pytest.raises(ValueError):
        opened_month_kst(datetime(2025, 12, 31, 15, 0))  # noqa: DTZ001 - 경계 거부를 확인한다.


def test_철회_수의_분모_성숙도를_일수로_남긴다() -> None:
    opened_at = datetime(2026, 3, 1, 1, 0, tzinfo=UTC)

    assert withdrawal_cohort_age_days(
        as_of=datetime(2026, 3, 1, 2, 0, tzinfo=UTC), opened_at=opened_at
    ) == 0
    assert withdrawal_cohort_age_days(
        as_of=datetime(2026, 3, 31, 2, 0, tzinfo=UTC), opened_at=opened_at
    ) == 30
