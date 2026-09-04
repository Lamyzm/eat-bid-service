"""모듈 책임: `wire_text`가 만든 canonical 값을 eat-v2 계약 타입의 값으로 감싼다.

왜 v1과 나누나. 두 계약의 `Money`·`InstantText`는 JSON 모양이 같아도 서로 다른 생성 클래스라
한쪽 인스턴스를 다른 쪽 필드에 넣으면 Pydantic이 거부한다. 해석 규칙은 `wire_text` 하나가 갖고
버전별 봉투만 여기서 씌워야 v1 발행물의 바이트가 v2 작업에 흔들리지 않는다.
"""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v2 import (
    BidRate,
    InstantText,
    Label,
    Money,
    NonNegativeCount,
    ObservedBidRate,
    ReservePriceRatio,
    SourceCodedValue,
)
from eatbid.source.eat.wire_text import (
    canonical_bid_rate_text,
    canonical_instant_text,
    canonical_money_amount,
    canonical_observed_bid_rate_text,
    canonical_reserve_price_ratio_text,
    optional_count,
    optional_text,
)

# 관측 하나가 어느 시스템에서 왔는지는 코드 값과 함께 실려야 한다. eaT 코드 체계는 다른 소스의
# 같은 문자열과 절대 암묵적으로 같지 않다(AGENTS 6).
SOURCE_SYSTEM = "eat"


def optional_instant_text(
    row: Mapping[str, str], field: str, source_format: str
) -> InstantText | None:
    value = canonical_instant_text(row, field, source_format)
    return InstantText(root=value) if value is not None else None


def optional_money(row: Mapping[str, str], field: str) -> Money | None:
    amount = canonical_money_amount(row, field)
    return Money(amount=amount, currency="KRW") if amount is not None else None


def optional_nonnegative_count(
    row: Mapping[str, str], field: str
) -> NonNegativeCount | None:
    count = optional_count(row, field)
    return NonNegativeCount(root=count) if count is not None else None


def optional_bid_rate(row: Mapping[str, str], field: str) -> BidRate | None:
    value = canonical_bid_rate_text(row, field)
    return (
        BidRate(value=value, unit="percentage-points") if value is not None else None
    )


def optional_observed_bid_rate(
    row: Mapping[str, str], field: str
) -> ObservedBidRate | None:
    """소스가 계산한 사정률을 상한 없는 관측 타입으로 감싼다. 정의상 0~100인 하한율과는 다른 타입이다."""
    value = canonical_observed_bid_rate_text(row, field)
    return (
        ObservedBidRate(value=value, unit="percentage-points")
        if value is not None
        else None
    )


def optional_reserve_price_ratio(
    row: Mapping[str, str], field: str
) -> ReservePriceRatio | None:
    value = canonical_reserve_price_ratio_text(row, field)
    return ReservePriceRatio(value=value, unit="ratio") if value is not None else None


def optional_source_coded_value(
    row: Mapping[str, str],
    code_field: str,
    *,
    code_scheme: str,
    label_field: str | None = None,
) -> SourceCodedValue | None:
    """외부 코드를 `(source_system, code_scheme, code)`와 표시 라벨로 나눠 싣는다.

    라벨만 있고 코드가 없는 관측은 `None`이다. 표시 문자열을 코드 자리에 넣으면 그 문자열이
    정체성이 되어버리기 때문이다(AGENTS 2).
    """
    code = optional_text(row, code_field)
    if code is None:
        return None
    label = optional_text(row, label_field) if label_field is not None else None
    return SourceCodedValue(
        source_system=SOURCE_SYSTEM,
        code_scheme=code_scheme,
        code=code,
        label=Label(root=label) if label is not None else None,
    )
