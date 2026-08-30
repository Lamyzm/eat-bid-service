from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class BidListPage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    total_count: int = Field(ge=0)
    external_bid_ids: tuple[str, ...]
