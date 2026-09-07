"""모듈 책임: 검토된 eaT 목록 응답의 known-column source 모델을 엄격한 Pydantic 권위로 둔다."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from eatbid.generated.ingestion_v1 import InstantText, Money, SourceCode


class BidListRow(BaseModel):
    """목록 한 행에서 검토된 column만 해석한 값이다.

    왜 목록 행이 모델인가. 2026-09-03 실측(EAT-34)에서 목록 한 페이지가 전국 열린 공고의 `BID_CNT`와
    `LAST_CHG_DT`를 이미 준다. 경쟁자 수 추적과 상세 재호출 판단은 이 값으로 한다. 단 `LAST_CHG_DT`는
    투찰 도착을 반영하지 않으므로(2026-09-06 실측) poll-open의 재호출은 `BID_CNT`·상태·마감·변경
    시각 넷의 변화와 마감 전이로 정한다(ADR 0037). wire column 이름은 파서에만 있고 여기서는 의미로
    부른다.
    """

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    external_bid_id: str = Field(min_length=1)
    competitor_count: int = Field(ge=0)
    status_name: str = Field(min_length=1)
    deadline_at: InstantText
    last_changed_at: InstantText
    base_amount: Money | None = None
    planned_price_type_name: str | None = None
    buyer_organization_code: SourceCode | None = None
    buyer_organization_name: str | None = None
    award_method_name: str | None = None


class BidListPage(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    total_count: int = Field(ge=0)
    rows: tuple[BidListRow, ...]

    @property
    def external_bid_ids(self) -> tuple[str, ...]:
        return tuple(row.external_bid_id for row in self.rows)
