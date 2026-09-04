"""모듈 책임: 검토된 eaT XML을 source 계약에 따라 목록과 정규화 상세 모델로 해석한다."""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import InvalidOperation

from pydantic import ValidationError

from eatbid.errors import SourceContractError
from eatbid.generated.ingestion_v1 import (
    CategorySource,
    DisplayBidNumber,
    EatbidIngestionAuctionV1,
    NormalizedAuctionIdentity,
    NormalizedAuctionPricing,
    NormalizedAuctionSchedule,
    NormalizedBuyer,
    NormalizedClassification,
    NormalizedLocation,
    SourceCategoryLabel,
    SourceCode,
)
from eatbid.source.eat.models import BidListPage, BidListRow
from eatbid.source.eat.payload import MAX_ELECTRONIC_BID_ID_DIGITS
from eatbid.source.eat.schema_contract import reviewed_schema_contract
from eatbid.source.eat.wire_values import (
    optional_instant_text,
    optional_money,
    optional_source_code,
    optional_text,
    required_text,
)
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro, schema_fingerprint

_NONNEGATIVE_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_POSITIVE_DECIMAL = re.compile(r"[1-9][0-9]*")

_BID_LIST_SCHEMA = reviewed_schema_contract(
    source="eat", endpoint="bid-list", parser_version="eat-v1"
)
if _BID_LIST_SCHEMA is None:  # pragma: no cover - import-time invariant
    raise RuntimeError("reviewed bid-list schema contract is required")
_BID_DETAIL_SCHEMA = reviewed_schema_contract(
    source="eat", endpoint="bid-detail", parser_version="eat-v1"
)
if _BID_DETAIL_SCHEMA is None:  # pragma: no cover - import-time invariant
    raise RuntimeError("reviewed bid-detail schema contract is required")
_BID_DETAIL_REQUIRED = _BID_DETAIL_SCHEMA.required_datasets
(_BID_LIST_DATASET,) = tuple(_BID_LIST_SCHEMA.datasets)
_TOTAL_COUNT_FIELD = "TOT_CNT"
_EXTERNAL_BID_ID_FIELD = "ETN_BID_ID"
_COMPETITOR_COUNT_FIELD = "BID_CNT"
_LIST_STATUS_FIELD = "ETN_BID_STT_NM"
_LIST_DEADLINE_FIELD = "BID_END_DT"
_LIST_LAST_CHANGED_FIELD = "LAST_CHG_DT"
_LIST_REQUIRED_FIELDS = _BID_LIST_SCHEMA.required_datasets[_BID_LIST_DATASET]
if set(_LIST_REQUIRED_FIELDS) != {
    _TOTAL_COUNT_FIELD,
    _EXTERNAL_BID_ID_FIELD,
    _COMPETITOR_COUNT_FIELD,
    _LIST_STATUS_FIELD,
    _LIST_DEADLINE_FIELD,
    _LIST_LAST_CHANGED_FIELD,
}:  # pragma: no cover - import-time invariant
    raise RuntimeError("bid-list parser and reviewed required columns diverged")


class EatDetailValidationError(ValueError):
    def __init__(self, message: str, *, schema_fingerprint: str | None = None) -> None:
        super().__init__(message)
        self.schema_fingerprint = schema_fingerprint


@dataclass(frozen=True, slots=True)
class NormalizedDetail:
    record: EatbidIngestionAuctionV1
    schema_fingerprint: str


def parse_bid_list_page(payload: bytes) -> BidListPage:
    parsed = parse_nexacro(payload)
    rows = parsed.datasets.get(_BID_LIST_DATASET)
    if not rows:
        raise SourceContractError(f"{_BID_LIST_DATASET} must contain at least one row")

    totals = {row.get(_TOTAL_COUNT_FIELD, "") for row in rows}
    if len(totals) != 1:
        raise SourceContractError(
            f"{_TOTAL_COUNT_FIELD} must be stable across a list page"
        )
    total_text = next(iter(totals))
    if _NONNEGATIVE_DECIMAL.fullmatch(total_text) is None:
        raise SourceContractError(
            f"{_TOTAL_COUNT_FIELD} must be nonnegative ASCII decimal text"
        )

    total_count = int(total_text)
    wire_ids = tuple(row.get(_EXTERNAL_BID_ID_FIELD, "") for row in rows)
    if total_count == 0 and wire_ids == ("",):
        return BidListPage(total_count=0, rows=())
    if any(
        _POSITIVE_DECIMAL.fullmatch(source_id) is None
        or len(source_id) > MAX_ELECTRONIC_BID_ID_DIGITS
        for source_id in wire_ids
    ):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be bounded positive ASCII decimal text"
        )
    if len(set(wire_ids)) != len(wire_ids):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be unique within a page"
        )
    if len(wire_ids) > total_count:
        raise SourceContractError(f"page row count exceeds {_TOTAL_COUNT_FIELD}")
    return BidListPage(
        total_count=total_count, rows=tuple(_bid_list_row(row) for row in rows)
    )


def _bid_list_row(row: Mapping[str, str]) -> BidListRow:
    """목록 행의 검토된 column을 해석한다. 필수 column의 부재나 잘못된 값은 발견 전체의 계약 위반이다."""
    try:
        competitor_text = required_text(row, _COMPETITOR_COUNT_FIELD)
        if _NONNEGATIVE_DECIMAL.fullmatch(competitor_text) is None:
            raise ValueError(
                f"{_COMPETITOR_COUNT_FIELD} must be nonnegative ASCII decimal text"
            )
        deadline_at = optional_instant_text(row, _LIST_DEADLINE_FIELD, "%Y%m%d%H%M%S")
        last_changed_at = optional_instant_text(
            row, _LIST_LAST_CHANGED_FIELD, "%Y%m%d%H%M%S"
        )
        if deadline_at is None or last_changed_at is None:
            raise ValueError(
                f"{_LIST_DEADLINE_FIELD} and {_LIST_LAST_CHANGED_FIELD} are required"
            )
        return BidListRow(
            external_bid_id=required_text(row, _EXTERNAL_BID_ID_FIELD),
            competitor_count=int(competitor_text),
            status_name=required_text(row, _LIST_STATUS_FIELD),
            deadline_at=deadline_at,
            last_changed_at=last_changed_at,
            base_amount=optional_money(row, "STRPRCE"),
            planned_price_type_name=optional_text(row, "PLNPRCE_TYPE_NM"),
            buyer_organization_code=optional_source_code(row, "PURR_CD"),
            buyer_organization_name=optional_text(row, "PURR_NM"),
            award_method_name=optional_text(row, "SUCBD_DECISION_MTHD_NM"),
        )
    except (InvalidOperation, ValidationError, ValueError) as error:
        raise SourceContractError(f"invalid eaT list field: {error}") from None


def normalize_bid_detail(
    payload: bytes, *, external_bid_id: str, parser_version: str
) -> EatbidIngestionAuctionV1:
    return normalize_bid_detail_payload(
        payload,
        external_bid_id=external_bid_id,
        parser_version=parser_version,
    ).record


def normalize_bid_detail_payload(
    payload: bytes, *, external_bid_id: str, parser_version: str
) -> NormalizedDetail:
    if not isinstance(external_bid_id, str) or not external_bid_id:
        raise EatDetailValidationError("planned ELCTRN_BID_ID is required")
    if not isinstance(parser_version, str) or not parser_version:
        raise ValueError("parser_version is required")
    parsed = parse_nexacro(payload, require_ds_info=True)
    info = parsed.datasets["ds_info"][0]
    try:
        source_category = optional_text(info, "MAIN_ITEMS")
        record = EatbidIngestionAuctionV1(
            contract_version="eatbid.ingestion.auction.v1",
            identity=NormalizedAuctionIdentity(
                external_bid_id=external_bid_id,
                display_bid_number=_display_bid_number(info),
                title=required_text(info, "BID_NM"),
                status=required_text(info, "ELCTRN_BID_STT_NM"),
            ),
            buyer=NormalizedBuyer(
                organization_code=required_text(info, "PURR_CD"),
                organization_name=required_text(info, "PURR_NM"),
            ),
            location=NormalizedLocation(
                sido_code=optional_source_code(info, "SIDO_CD"),
                sigungu_code=optional_source_code(info, "SIGUNGU_CD"),
                eligibility_codes=[
                    SourceCode(root=code) for code in _eligibility_codes(parsed)
                ],
            ),
            schedule=NormalizedAuctionSchedule(
                announced_at=optional_instant_text(info, "PBANC_YMD", "%Y%m%d"),
                deadline_at=optional_instant_text(
                    info, "BID_END_DT", "%Y%m%d%H%M%S"
                ),
                opened_at=optional_instant_text(info, "OPNG_DT", "%Y%m%d%H%M%S"),
            ),
            pricing=NormalizedAuctionPricing(
                base_amount=optional_money(info, "BGNG_PRC"),
                planned_amount=optional_money(info, "ELCTRN_BID_PLNPRC"),
            ),
            classification=NormalizedClassification(
                source_category_label=(
                    SourceCategoryLabel(root=source_category)
                    if source_category is not None
                    else None
                ),
                category_source=(
                    CategorySource.source_field
                    if source_category is not None
                    else CategorySource.unknown
                ),
            ),
        )
    except (InvalidOperation, ValidationError, ValueError) as error:
        if isinstance(error, EatDetailValidationError):
            raise
        raise EatDetailValidationError(
            f"invalid eaT detail field: {error}",
            schema_fingerprint=_contract_fingerprint(parsed),
        ) from error
    return NormalizedDetail(
        record=record, schema_fingerprint=_contract_fingerprint(parsed)
    )


def _contract_fingerprint(parsed: ParsedNexacro) -> str:
    """왜 응답 전체가 아니라 검토된 필수 부분집합으로 계산하나.

    2026-09-03 실측에서 같은 창의 상세 85건이 전체 모양 fingerprint를 12가지로 갈랐다. 공고 유형에
    따라 선택적 dataset이 붙거나 빠지기 때문이다. 전체 모양의 동일성을 계약으로 삼으면 어떤 live
    수집도 발행되지 않고, 소스가 필드를 하나 늘릴 때마다 제품이 멈춘다.

    계약이 주장해야 하는 것은 파서가 의존하는 필수 부분집합의 존재다. 그 교집합으로 계산하므로
    필수 column이 하나라도 빠지면 값이 달라져 격리되고, 모르는 column이 더 있어도 해석하지 않으니
    추측이 들어가지 않는다. 응답 전체 모양은 보존된 원본에서 언제든 다시 계산할 수 있다.
    """
    return schema_fingerprint(
        {
            dataset: [
                column
                for column in required
                if any(column in row for row in parsed.datasets.get(dataset, ()))
            ]
            for dataset, required in _BID_DETAIL_REQUIRED.items()
        }
    )


def canonical_payload(record: EatbidIngestionAuctionV1) -> bytes:
    if not isinstance(record, EatbidIngestionAuctionV1):
        raise TypeError("record must be an EatbidIngestionAuctionV1")
    return json.dumps(
        record.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _display_bid_number(row: Mapping[str, str]) -> DisplayBidNumber | None:
    value = optional_text(row, "ELCTRN_BID_NO")
    return DisplayBidNumber(root=value) if value is not None else None


def _eligibility_codes(parsed: ParsedNexacro) -> tuple[str, ...]:
    codes: list[str] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        code = required_text(row, "PDLC_CD")
        if code in codes:
            raise ValueError("duplicate PDLC_CD in ds_areaList")
        codes.append(code)
    return tuple(codes)
