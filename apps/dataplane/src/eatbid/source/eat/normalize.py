"""모듈 책임: 검토된 eaT XML을 source 계약에 따라 목록과 정규화 상세 모델로 해석한다."""

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
from eatbid.source.eat.payload import MAX_ELECTRONIC_BID_ID_DIGITS
from eatbid.source.eat.schema_contract import reviewed_schema_contract
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro, schema_fingerprint

_NONNEGATIVE_DECIMAL = re.compile(r"0|[1-9][0-9]*")
_POSITIVE_DECIMAL = re.compile(r"[1-9][0-9]*")
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
(_TOTAL_COUNT_FIELD, _EXTERNAL_BID_ID_FIELD) = _BID_LIST_SCHEMA.datasets[
    _BID_LIST_DATASET
]


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
        return BidListPage(total_count=0, external_bid_ids=())
    external_bid_ids = wire_ids
    if any(
        _POSITIVE_DECIMAL.fullmatch(source_id) is None
        or len(source_id) > MAX_ELECTRONIC_BID_ID_DIGITS
        for source_id in external_bid_ids
    ):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be bounded positive ASCII decimal text"
        )
    if len(set(external_bid_ids)) != len(external_bid_ids):
        raise SourceContractError(
            f"{_EXTERNAL_BID_ID_FIELD} must be unique within a page"
        )
    if len(external_bid_ids) > total_count:
        raise SourceContractError(f"page row count exceeds {_TOTAL_COUNT_FIELD}")
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
