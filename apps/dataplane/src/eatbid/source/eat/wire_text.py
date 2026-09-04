"""모듈 책임: eaT wire 문자열을 계약 버전과 무관한 canonical text·정수로 해석한다. 서울 벽시각의
fold 판정과 금액·비율의 정밀도 규칙이 여기 있고, 어떤 계약 타입으로 감쌀지는 호출부가 정한다."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

# 왜 시각이 세 모양인가. 2026-09-03 live eaT 실측에서 시각 필드는 밀리초 세 자리를 붙인
# yyyyMMddHHmmssSSS 17자리였고, 아카이브된 원본에는 14자리가 남아 있다. 명단의 `BID_DT`만 하이픈·
# 공백·콜론이 있는 19자다(2026-09-04 실측). 셋 다 폭이 고정이라 모호하지 않으므로 각각을 검토된
# wire 모양으로 선언한다. 검증기를 느슨하게 만드는 것이 아니다.
_SOURCE_TIME_WIRE_SHAPES: dict[str, tuple[tuple[re.Pattern[str], int, str], ...]] = {
    "%Y%m%d": ((re.compile(r"[0-9]{8}"), 8, "%Y%m%d"),),
    "%Y%m%d%H%M%S": (
        (re.compile(r"[0-9]{14}"), 14, "%Y%m%d%H%M%S"),
        (re.compile(r"[0-9]{17}"), 17, "%Y%m%d%H%M%S%f"),
    ),
    "%Y-%m-%d %H:%M:%S": (
        (
            re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}"),
            19,
            "%Y-%m-%d %H:%M:%S",
        ),
    ),
}
_SEOUL_TIME = ZoneInfo("Asia/Seoul")
_KRW_SCALE = Decimal("0.01")
_BID_RATE_SCALE = Decimal("0.001")
_RESERVE_PRICE_RATIO_SCALE = Decimal("0.000001")
# 계약 atom `ObservedBidRateText`가 허용하는 정수부 12자리의 최대값이다. 상한을 계약보다 좁게 두면
# 계약이 담을 수 있는 관측을 파서가 격리하게 된다.
_OBSERVED_BID_RATE_MAXIMUM = Decimal("999999999999.999")
_MAX_COUNT = 2147483647
_ASCII_DECIMAL = re.compile(r"0|[1-9][0-9]*")


def required_text(row: Mapping[str, str], field: str) -> str:
    value = row.get(field, "")
    if value == "":
        raise ValueError(f"{field} is required")
    return value


def optional_text(row: Mapping[str, str], field: str) -> str | None:
    value = row.get(field, "")
    return value if value != "" else None


def optional_count(row: Mapping[str, str], field: str) -> int | None:
    """관측된 행 수·순위·번호를 계약의 `NonNegativeCount` 범위 안 정수로 읽는다.

    상한을 두는 이유는 이 값이 PostgreSQL integer 열로 내려가기 때문이다. 범위를 넘는 관측은
    조용히 잘리는 대신 거부되어 그 관측만 격리된다.
    """
    value = optional_text(row, field)
    if value is None:
        return None
    if _ASCII_DECIMAL.fullmatch(value) is None:
        raise ValueError(f"{field} must be nonnegative ASCII decimal text")
    count = int(value)
    if count > _MAX_COUNT:
        raise ValueError(f"{field} exceeds the contract count range")
    return count


def canonical_instant_text(
    row: Mapping[str, str], field: str, source_format: str
) -> str | None:
    value = optional_text(row, field)
    if value is None:
        return None
    shapes = _SOURCE_TIME_WIRE_SHAPES.get(source_format)
    if shapes is None:
        raise ValueError(f"unsupported eaT source time format: {source_format}")
    # strptime은 zero-padding이 빠진 숫자도 받아들이므로 source wire 모양을 먼저 닫아야 한다.
    matched = next(
        (shape for shape in shapes if shape[0].fullmatch(value) is not None), None
    )
    if matched is None:
        widths = " or ".join(str(shape[1]) for shape in shapes)
        raise ValueError(f"{field} must be exactly {widths} ASCII digits")
    _, _, strptime_format = matched
    try:
        # eaT 값은 지역 벽시각이므로 fold 후보를 검증하기 전까지 timezone을 붙이지 않는다.
        wall_time = datetime.strptime(value, strptime_format)  # noqa: DTZ007
    except ValueError as error:
        raise ValueError(f"{field} does not match {strptime_format}") from error
    return _canonical_instant_text(_resolve_seoul_wall_time(wall_time, field))


def _canonical_instant_text(instant: datetime) -> str:
    """왜: 계약이 소수부의 후행 0을 금지하므로 같은 instant는 폭과 무관하게 같은 text가 된다."""
    seconds = instant.strftime("%Y-%m-%dT%H:%M:%S")
    if instant.microsecond == 0:
        return f"{seconds}Z"
    fraction = f"{instant.microsecond:06d}".rstrip("0")
    return f"{seconds}.{fraction}Z"


def _resolve_seoul_wall_time(wall_time: datetime, field: str) -> datetime:
    """fold 기본값으로 존재하지 않거나 모호한 서울 시각을 임의의 instant로 만들지 않는다."""
    candidates: dict[tuple[datetime, timedelta], datetime] = {}
    for fold in (0, 1):
        local_time = wall_time.replace(tzinfo=_SEOUL_TIME, fold=fold)
        instant = local_time.astimezone(UTC)
        round_trip = instant.astimezone(_SEOUL_TIME)
        offset = local_time.utcoffset()
        if offset is None or round_trip.replace(tzinfo=None) != wall_time:
            continue
        candidates[(instant, offset)] = instant
    if len(candidates) == 0:
        raise ValueError(f"{field} is a nonexistent Asia/Seoul wall time")
    if len(candidates) > 1:
        raise ValueError(f"{field} is an ambiguous Asia/Seoul wall time")
    return next(iter(candidates.values()))


def canonical_money_amount(row: Mapping[str, str], field: str) -> str | None:
    value = optional_text(row, field)
    if value is None:
        return None
    amount = Decimal(value)
    exponent = amount.as_tuple().exponent
    if (
        not amount.is_finite()
        or amount.is_signed()
        or not isinstance(exponent, int)
        or exponent < -2
    ):
        raise ValueError(f"{field} must be a nonnegative KRW amount at scale 2")
    return format(amount.quantize(_KRW_SCALE), "f")


def canonical_bid_rate_text(row: Mapping[str, str], field: str) -> str | None:
    """사정률·하한율을 소수 셋째 자리 percentage-points로 읽는다.

    왜 quantize하나. 소스는 90.218·91.87·90처럼 자릿수를 섞어 보낸다. 계약이 정한 정밀도는 셋째
    자리이고 그보다 짧은 값은 손실 없이 늘어난다. 셋째 자리보다 정밀한 값은 반올림하지 않고
    거부한다 — 그건 계약 밖의 관측이라 반올림하면 우리가 만든 값이 된다.
    """
    return _canonical_decimal_text(
        row,
        field,
        scale=_BID_RATE_SCALE,
        scale_digits=3,
        maximum=Decimal(100),
        unit="bid rate",
    )


def canonical_observed_bid_rate_text(row: Mapping[str, str], field: str) -> str | None:
    """소스가 계산한 사정률(SAJEONG_PCT)을 소수 셋째 자리 percentage-points로 읽되 100 상한을 두지 않는다.

    예정가격 초과 투찰은 100을 넘고 단가 입찰의 총액 투찰은 수천만까지 튄다(2026-09-04 전수 관측
    최대 44,477,738.05). 상한 100으로 거부하면 관측을 격리하게 되므로 계약 정수부 12자리까지만
    막는다. 하한율처럼 정의상 0~100인 값은 `canonical_bid_rate_text`를 그대로 쓴다.
    """
    return _canonical_decimal_text(
        row,
        field,
        scale=_BID_RATE_SCALE,
        scale_digits=3,
        maximum=_OBSERVED_BID_RATE_MAXIMUM,
        unit="source bid rate",
    )


def canonical_reserve_price_ratio_text(
    row: Mapping[str, str], field: str
) -> str | None:
    """복수예정가격 후보의 기초금액 대비 배율을 소수 여섯째 자리로 읽는다.

    상한이 1이 아니라 10인 이유는 관측 분포가 0.9701~1.0218로 1을 넘기 때문이다. 0~1 비율 계약을
    재사용하면 관측된 후보의 절반이 거부된다.
    """
    return _canonical_decimal_text(
        row,
        field,
        scale=_RESERVE_PRICE_RATIO_SCALE,
        scale_digits=6,
        maximum=Decimal("9.999999"),
        unit="reserve price ratio",
    )


def _canonical_decimal_text(
    row: Mapping[str, str],
    field: str,
    *,
    scale: Decimal,
    scale_digits: int,
    maximum: Decimal,
    unit: str,
) -> str | None:
    value = optional_text(row, field)
    if value is None:
        return None
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{field} must be {unit} decimal text") from None
    exponent = parsed.as_tuple().exponent
    if (
        not parsed.is_finite()
        or parsed.is_signed()
        or parsed > maximum
        or not isinstance(exponent, int)
        or exponent < -scale_digits
    ):
        raise ValueError(
            f"{field} must be a {unit} at most {maximum} at scale {scale_digits}"
        )
    return format(parsed.quantize(scale), "f")
