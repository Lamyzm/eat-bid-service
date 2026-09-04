"""모듈 책임: `wire_text`가 만든 canonical 값을 eat-v1 계약 타입의 값으로 감싼다."""

from __future__ import annotations

from collections.abc import Mapping

from eatbid.generated.ingestion_v1 import InstantText, Money, SourceCode
from eatbid.source.eat.wire_text import (
    canonical_instant_text,
    canonical_money_amount,
    optional_text,
)


def optional_source_code(row: Mapping[str, str], field: str) -> SourceCode | None:
    value = optional_text(row, field)
    return SourceCode(root=value) if value is not None else None


def optional_instant_text(
    row: Mapping[str, str], field: str, source_format: str
) -> InstantText | None:
    value = canonical_instant_text(row, field, source_format)
    return InstantText(root=value) if value is not None else None


def optional_money(row: Mapping[str, str], field: str) -> Money | None:
    amount = canonical_money_amount(row, field)
    return Money(amount=amount, currency="KRW") if amount is not None else None
