from __future__ import annotations

import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from pydantic import ValidationError

from eatbid.source.eat.models import BidListPage, NormalizedAuction
from eatbid.source.eat.xml import ParsedNexacro, SourceContractError, parse_nexacro

_NONNEGATIVE_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_SEOUL_TIME = timezone(timedelta(hours=9))


class EatDetailValidationError(ValueError):
    def __init__(self, message: str, *, schema_fingerprint: str | None = None) -> None:
        super().__init__(message)
        self.schema_fingerprint = schema_fingerprint


@dataclass(frozen=True, slots=True)
class NormalizedDetail:
    record: NormalizedAuction
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
) -> NormalizedAuction:
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
        record = NormalizedAuction(
            external_bid_id=external_bid_id,
            display_bid_no=_optional_text(info, "ELCTRN_BID_NO"),
            title=_required_text(info, "BID_NM"),
            source_status=_required_text(info, "ELCTRN_BID_STT_NM"),
            organization_code=_required_text(info, "PURR_CD"),
            organization_name=_required_text(info, "PURR_NM"),
            sido_code=_optional_text(info, "SIDO_CD"),
            sigungu_code=_optional_text(info, "SIGUNGU_CD"),
            eligibility_codes=_eligibility_codes(parsed),
            announced_at=_optional_datetime(info, "PBANC_YMD", "%Y%m%d"),
            deadline_at=_optional_datetime(info, "BID_END_DT", "%Y%m%d%H%M%S"),
            opened_at=_optional_datetime(info, "OPNG_DT", "%Y%m%d%H%M%S"),
            base_amount=_optional_decimal(info, "BGNG_PRC"),
            planned_amount=_optional_decimal(info, "ELCTRN_BID_PLNPRC"),
            source_category_label=source_category,
            category_source="source_field" if source_category is not None else "unknown",
        )
    except (InvalidOperation, ValidationError, ValueError) as error:
        if isinstance(error, EatDetailValidationError):
            raise
        raise EatDetailValidationError(
            f"invalid eaT detail field: {error}",
            schema_fingerprint=parsed.schema_fingerprint,
        ) from error
    return NormalizedDetail(record=record, schema_fingerprint=parsed.schema_fingerprint)


def canonical_payload(record: NormalizedAuction) -> bytes:
    if not isinstance(record, NormalizedAuction):
        raise TypeError("record must be a NormalizedAuction")
    return json.dumps(
        record.model_dump(mode="json"),
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


def _optional_datetime(
    row: Mapping[str, str], field: str, source_format: str
) -> datetime | None:
    value = _optional_text(row, field)
    if value is None:
        return None
    try:
        parsed = datetime.strptime(value, source_format).replace(tzinfo=_SEOUL_TIME)
    except ValueError as error:
        raise ValueError(f"{field} does not match {source_format}") from error
    return parsed


def _optional_decimal(row: Mapping[str, str], field: str) -> Decimal | None:
    value = _optional_text(row, field)
    return Decimal(value) if value is not None else None


def _eligibility_codes(parsed: ParsedNexacro) -> tuple[str, ...]:
    codes: list[str] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        code = _required_text(row, "PDLC_CD")
        if code in codes:
            raise ValueError("duplicate PDLC_CD in ds_areaList")
        codes.append(code)
    return tuple(codes)
