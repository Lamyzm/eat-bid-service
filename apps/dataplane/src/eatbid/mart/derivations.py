"""모듈 책임: 그날 하한·표시 비율·구간 경계·KST 달 경계의 파생 규칙을 사람이 읽는 정의로 둔다.

빌드는 2,700만 행을 한 번에 통과해야 해서 실제 계산은 PostgreSQL이 한다. 이 module의 함수는 그
규칙의 사람이 읽는 정의이며, 조사 자료의 실측값과 대조하는 단위 test가 여기에 붙는다. SQL과 이
정의가 갈라지지 않도록 통합 test가 같은 입력에 대해 두 결과를 맞대어 본다.

두 축이 섞이지 않게 하는 것이 이 module의 핵심이다. 사정률은 분모가 예정가격이고 투찰률은 분모가
기초금액이다. 하한 미만 수를 사정률 축에서 세는 이유는 그 축에서 나눗셈이 없어 반올림이 개입하지
않기 때문이며, 레일의 비교를 금액 축에서 하는 이유는 소스의 규칙이 사는 축이 금액이기 때문이다.
"""

from __future__ import annotations

from datetime import date, datetime
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from zoneinfo import ZoneInfo

KST = ZoneInfo("Asia/Seoul")

# 금액은 원 단위 소수 둘째 자리, 표시용 투찰률은 소수 넷째 자리, 사정률 구간은 소수 셋째 자리다.
MONEY_QUANTUM = Decimal("0.01")
DISPLAY_RATE_QUANTUM = Decimal("0.0001")
# 호가창 한 칸의 폭이다. 이 값을 바꾸면 `mart.build.calc_version`이 바뀐다.
DISTRIBUTION_BIN_WIDTH = Decimal("0.010")


def day_floor_amount(*, floor_rate: Decimal, planned_amount: Decimal) -> Decimal:
    """그날 하한 금액이다. 내림하는 이유는 올림이 유효한 투찰 하나를 없는 것으로 만들기 때문이다."""
    return (floor_rate / Decimal(100) * planned_amount).quantize(
        MONEY_QUANTUM, rounding=ROUND_DOWN
    )


def day_floor_bid_rate(
    *, floor_rate: Decimal, planned_amount: Decimal, base_amount: Decimal
) -> Decimal:
    """그날 하한을 투찰률 축으로 옮긴 표시값이다. 비교의 권위는 이 값이 아니라 금액이다."""
    return _to_bid_axis(floor_rate, planned_amount=planned_amount, base_amount=base_amount)


def awarded_bid_rate(
    *, assessment_rate: Decimal, planned_amount: Decimal, base_amount: Decimal
) -> Decimal:
    """낙찰 사정률을 같은 투찰률 축으로 옮긴 표시값이다."""
    return _to_bid_axis(assessment_rate, planned_amount=planned_amount, base_amount=base_amount)


def _to_bid_axis(
    rate: Decimal, *, planned_amount: Decimal, base_amount: Decimal
) -> Decimal:
    if base_amount <= 0:
        raise ValueError("base amount must be positive to translate a rate axis")
    return (rate * planned_amount / base_amount).quantize(
        DISPLAY_RATE_QUANTUM, rounding=ROUND_HALF_UP
    )


def below_day_floor_count(assessment_rates: tuple[Decimal, ...], *, floor_rate: Decimal) -> int:
    """사정률 축에서 그날 하한 미만을 센다. 부등식 양변에 같은 양수를 곱한 것이라 투찰률 축에서 세도 같다."""
    return sum(1 for rate in assessment_rates if rate < floor_rate)


def distribution_bin_lower(
    assessment_rate: Decimal, *, bin_width: Decimal = DISTRIBUTION_BIN_WIDTH
) -> Decimal:
    """반개구간 `[bin_lower, bin_lower + bin_width)`의 아래 경계다. 정확 연산이라 부동소수를 거치지 않는다."""
    if bin_width <= 0:
        raise ValueError("bin width must be positive")
    return (assessment_rate / bin_width).to_integral_value(
        rounding=ROUND_DOWN
    ) * bin_width


def opened_month_kst(opened_at: datetime) -> date:
    """개찰이 속한 KST 달의 1일이다. 공고가 아니라 개찰이 기준인 이유는 낙찰률이 개찰의 결과이기 때문이다."""
    if opened_at.utcoffset() is None:
        raise ValueError("opened_at must be timezone-aware")
    local = opened_at.astimezone(KST)
    return date(local.year, local.month, 1)


def withdrawal_cohort_age_days(*, as_of: datetime, opened_at: datetime) -> int:
    """철회 수의 분모 성숙도다. 개찰 직후의 0과 한 달 뒤의 0은 같은 사실이 아니다."""
    if as_of.utcoffset() is None or opened_at.utcoffset() is None:
        raise ValueError("as_of and opened_at must be timezone-aware")
    return (as_of.astimezone(KST).date() - opened_at.astimezone(KST).date()).days
