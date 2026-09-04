"""모듈 책임: 검토된 eaT wire 값(서울 벽시각·KRW 금액·코드)을 canonical 계약 값으로 해석한다."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

from eatbid.generated.ingestion_v1 import InstantText, Money, SourceCode

# 왜 시각이 두 모양인가. 2026-09-03 live eaT 실측에서 시각 필드는 밀리초 세 자리를 붙인
# yyyyMMddHHmmssSSS 17자리였고, 아카이브된 원본에는 14자리가 남아 있다. 둘 다 고정 폭이라
# 모호하지 않으므로 각각을 검토된 wire 모양으로 선언한다. 검증기를 넓히는 것이 아니다.
_SOURCE_TIME_WIRE_SHAPES: dict[str, tuple[tuple[re.Pattern[str], int, str], ...]] = {
    "%Y%m%d": ((re.compile(r"[0-9]{8}"), 8, "%Y%m%d"),),
    "%Y%m%d%H%M%S": (
        (re.compile(r"[0-9]{14}"), 14, "%Y%m%d%H%M%S"),
        (re.compile(r"[0-9]{17}"), 17, "%Y%m%d%H%M%S%f"),
    ),
}
_SEOUL_TIME = ZoneInfo("Asia/Seoul")
_KRW_SCALE = Decimal("0.01")


def required_text(row: Mapping[str, str], field: str) -> str:
    value = row.get(field, "")
    if value == "":
        raise ValueError(f"{field} is required")
    return value


def optional_text(row: Mapping[str, str], field: str) -> str | None:
    value = row.get(field, "")
    return value if value != "" else None


def optional_source_code(row: Mapping[str, str], field: str) -> SourceCode | None:
    value = optional_text(row, field)
    return SourceCode(root=value) if value is not None else None


def optional_instant_text(
    row: Mapping[str, str], field: str, source_format: str
) -> InstantText | None:
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
    resolved = _resolve_seoul_wall_time(wall_time, field)
    return InstantText(root=_canonical_instant_text(resolved))


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


def optional_money(row: Mapping[str, str], field: str) -> Money | None:
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
    fixed_amount = format(amount.quantize(_KRW_SCALE), "f")
    return Money(amount=fixed_amount, currency="KRW")
