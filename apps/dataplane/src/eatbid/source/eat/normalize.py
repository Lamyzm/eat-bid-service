from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from eatbid.errors import SourceContractError
from eatbid.generated.ingestion_v1 import (
    CategorySource,
    DisplayBidNumber,
    EatbidIngestionAuctionV1,
    InstantText,
    Money,
    NormalizedAuctionIdentity,
    NormalizedAuctionPricing,
    NormalizedAuctionSchedule,
    NormalizedBuyer,
    NormalizedClassification,
    NormalizedLocation,
    SourceCategoryLabel,
    SourceCode,
)
from eatbid.source.eat.models import BidListPage
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro

_NONNEGATIVE_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_SEOUL_TIME = ZoneInfo("Asia/Seoul")
_KRW_SCALE = Decimal("0.01")


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
    rows = parsed.datasets.get("ds_list")
    if not rows:
        raise SourceContractError("ds_list must contain at least one row")

    totals = {row.get("TOT_CNT", "") for row in rows}
    if len(totals) != 1:
        raise SourceContractError("TOT_CNT must be stable across a list page")
    total_text = next(iter(totals))
    if _NONNEGATIVE_DECIMAL.fullmatch(total_text) is None:
        raise SourceContractError("TOT_CNT must be nonnegative ASCII decimal text")

    external_bid_ids = tuple(row.get("ETN_BID_ID", "") for row in rows)
    if any(not source_id for source_id in external_bid_ids):
        raise SourceContractError("ETN_BID_ID must be nonempty")
    if len(set(external_bid_ids)) != len(external_bid_ids):
        raise SourceContractError("ETN_BID_ID must be unique within a page")
    total_count = int(total_text)
    if len(external_bid_ids) > total_count:
        raise SourceContractError("page row count exceeds TOT_CNT")
    return BidListPage(total_count=total_count, external_bid_ids=external_bid_ids)


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
        source_category = _optional_text(info, "MAIN_ITEMS")
        record = EatbidIngestionAuctionV1(
            contract_version="eatbid.ingestion.auction.v1",
            identity=NormalizedAuctionIdentity(
                external_bid_id=external_bid_id,
                display_bid_number=_display_bid_number(info),
                title=_required_text(info, "BID_NM"),
                status=_required_text(info, "ELCTRN_BID_STT_NM"),
            ),
            buyer=NormalizedBuyer(
                organization_code=_required_text(info, "PURR_CD"),
                organization_name=_required_text(info, "PURR_NM"),
            ),
            location=NormalizedLocation(
                sido_code=_optional_source_code(info, "SIDO_CD"),
                sigungu_code=_optional_source_code(info, "SIGUNGU_CD"),
                eligibility_codes=[
                    SourceCode(root=code) for code in _eligibility_codes(parsed)
                ],
            ),
            schedule=NormalizedAuctionSchedule(
                announced_at=_optional_instant_text(info, "PBANC_YMD", "%Y%m%d"),
                deadline_at=_optional_instant_text(
                    info, "BID_END_DT", "%Y%m%d%H%M%S"
                ),
                opened_at=_optional_instant_text(info, "OPNG_DT", "%Y%m%d%H%M%S"),
            ),
            pricing=NormalizedAuctionPricing(
                base_amount=_optional_money(info, "BGNG_PRC"),
                planned_amount=_optional_money(info, "ELCTRN_BID_PLNPRC"),
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
            schema_fingerprint=parsed.schema_fingerprint,
        ) from error
    return NormalizedDetail(record=record, schema_fingerprint=parsed.schema_fingerprint)


def canonical_payload(record: EatbidIngestionAuctionV1) -> bytes:
    if not isinstance(record, EatbidIngestionAuctionV1):
        raise TypeError("record must be an EatbidIngestionAuctionV1")
    return json.dumps(
        record.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _required_text(row: Mapping[str, str], field: str) -> str:
    value = row.get(field, "")
    if value == "":
        raise ValueError(f"{field} is required")
    return value


def _optional_text(row: Mapping[str, str], field: str) -> str | None:
    value = row.get(field, "")
    return value if value != "" else None


def _display_bid_number(row: Mapping[str, str]) -> DisplayBidNumber | None:
    value = _optional_text(row, "ELCTRN_BID_NO")
    return DisplayBidNumber(root=value) if value is not None else None


def _optional_source_code(
    row: Mapping[str, str], field: str
) -> SourceCode | None:
    value = _optional_text(row, field)
    return SourceCode(root=value) if value is not None else None


def _optional_instant_text(
    row: Mapping[str, str], field: str, source_format: str
) -> InstantText | None:
    value = _optional_text(row, field)
    if value is None:
        return None
    try:
        # eaT 값은 지역 벽시각이므로 fold 후보를 검증하기 전까지 timezone을 붙이지 않는다.
        wall_time = datetime.strptime(value, source_format)  # noqa: DTZ007
    except ValueError as error:
        raise ValueError(f"{field} does not match {source_format}") from error
    instant = _resolve_seoul_wall_time(wall_time, field).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    return InstantText(root=instant)


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


def _optional_money(row: Mapping[str, str], field: str) -> Money | None:
    value = _optional_text(row, field)
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


def _eligibility_codes(parsed: ParsedNexacro) -> tuple[str, ...]:
    codes: list[str] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        code = _required_text(row, "PDLC_CD")
        if code in codes:
            raise ValueError("duplicate PDLC_CD in ds_areaList")
        codes.append(code)
    return tuple(codes)
