from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class BidListPage(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)

    total_count: int = Field(ge=0)
    external_bid_ids: tuple[str, ...]


class NormalizedAuction(BaseModel):
    model_config = ConfigDict(frozen=True, strict=True)

    external_bid_id: str = Field(min_length=1)
    display_bid_no: str | None
    title: str = Field(min_length=1)
    source_status: str = Field(min_length=1)
    organization_code: str = Field(min_length=1)
    organization_name: str = Field(min_length=1)
    sido_code: str | None
    sigungu_code: str | None
    eligibility_codes: tuple[str, ...]
    announced_at: datetime | None
    deadline_at: datetime | None
    opened_at: datetime | None
    base_amount: Decimal | None
    planned_amount: Decimal | None
    currency: Literal["KRW"] = "KRW"
    source_category_label: str | None
    category_source: Literal["source_field", "inferred_from_title", "unknown"]
