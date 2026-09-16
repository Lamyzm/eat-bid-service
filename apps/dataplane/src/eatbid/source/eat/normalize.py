"""모듈 책임: 검토된 eaT 상세 응답을 parser version이 고른 계약으로 정규화 공고 record로 조립한다."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import InvalidOperation
from types import MappingProxyType
from typing import Any

from pydantic import ValidationError

from eatbid.failures.errors import SourceContractError
from eatbid.generated.ingestion_v1 import EatbidIngestionAuctionV1
from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2, SourceCodedValue
from eatbid.source.eat.auction_terms import parse_auction_terms
from eatbid.source.eat.code_schemes import ELIGIBILITY_AREA, optional_scheme_value
from eatbid.source.eat.lineage import parse_lineage
from eatbid.source.eat.reserve_price import parse_reserve_price_draw
from eatbid.source.eat.roster import parse_award_decision, parse_bid_roster
from eatbid.source.eat.schema_contract import (
    ReviewedSchemaContract,
    reviewed_schema_contract,
)
from eatbid.source.eat.wire_text import (
    canonical_instant_text,
    canonical_money_amount,
    optional_text,
    required_text,
)
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro


def _require_detail_schema(parser_version: str) -> ReviewedSchemaContract:
    contract = reviewed_schema_contract(
        source="eat", endpoint="bid-detail", parser_version=parser_version
    )
    if contract is None:  # pragma: no cover - import-time invariant
        raise RuntimeError(
            f"reviewed bid-detail schema contract is required [{parser_version}]"
        )
    return contract


# 상세 계약과 조립 함수를 parser version 하나로 묶는다. 어떤 계약으로 읽었는지가 record 모양을
# 결정하므로 두 사실이 흩어지면 v2 응답을 v1 모양으로 저장하는 일이 조용히 일어난다.
_DETAIL_SCHEMAS: Mapping[str, ReviewedSchemaContract] = MappingProxyType(
    {
        version: _require_detail_schema(version)
        for version in ("eat-v1", "eat-v2", "eat-v3")
    }
)
# 참가제한지역 라벨(`PDLC_NM`)을 관측해 `location.eligibilityAreas`에 싣는 parser version이다. eat-v2는
# 이 키를 쓰지 않아 봉인된 바이트가 그대로이고, 라벨을 원하는 관측은 eat-v3로 새로 정규화한다(ADR 0038).
_AREA_LABEL_PARSER_VERSIONS = frozenset({"eat-v3"})


class EatDetailValidationError(ValueError):
    def __init__(self, message: str, *, schema_fingerprint: str | None = None) -> None:
        super().__init__(message)
        self.schema_fingerprint = schema_fingerprint


NormalizedAuctionRecord = EatbidIngestionAuctionV1 | EatbidIngestionAuctionV2


@dataclass(frozen=True, slots=True)
class NormalizedDetail:
    record: NormalizedAuctionRecord
    schema_fingerprint: str


def normalize_bid_detail(
    payload: bytes, *, external_bid_id: str, parser_version: str
) -> NormalizedAuctionRecord:
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
    schema = _DETAIL_SCHEMAS.get(parser_version)
    if schema is None:
        raise SourceContractError(
            f"eaT unknown-parser-version [endpoint=bid-detail "
            f"parser_version={parser_version}]"
        )
    parsed = parse_nexacro(payload, require_ds_info=True)
    info = parsed.datasets["ds_info"][0]
    try:
        shared = _shared_auction_fields(parsed, info, external_bid_id)
        record: NormalizedAuctionRecord = (
            EatbidIngestionAuctionV1(
                contract_version="eatbid.ingestion.auction.v1", **shared
            )
            if parser_version == "eat-v1"
            else _build_v2(
                parsed,
                info,
                shared,
                observe_area_labels=parser_version in _AREA_LABEL_PARSER_VERSIONS,
            )
        )
    except (InvalidOperation, ValidationError, ValueError) as error:
        if isinstance(error, EatDetailValidationError):
            raise
        raise EatDetailValidationError(
            f"invalid eaT detail field: {error}",
            schema_fingerprint=_contract_fingerprint(parsed, schema),
        ) from error
    return NormalizedDetail(
        record=record, schema_fingerprint=_contract_fingerprint(parsed, schema)
    )


def _shared_auction_fields(
    parsed: ParsedNexacro, info: Mapping[str, str], external_bid_id: str
) -> dict[str, Any]:
    """두 계약 버전이 같은 값을 갖는 부분을 JSON 모양 그대로 만든다.

    왜 모델 인스턴스가 아니라 dict인가. v1과 v2의 `Money`·`NormalizedBuyer`는 JSON이 같아도 서로 다른
    생성 클래스라 한쪽 인스턴스를 다른 root에 넣을 수 없다. 값 계산을 한 곳에 두고 봉투만 각 root가
    씌우면 v1 발행물의 canonical 바이트가 v2 작업으로 흔들리지 않는다(ADR 0025 sealed membership).
    """
    source_category = optional_text(info, "MAIN_ITEMS")
    return {
        "identity": {
            "external_bid_id": external_bid_id,
            "display_bid_number": optional_text(info, "ELCTRN_BID_NO"),
            "title": required_text(info, "BID_NM"),
            "status": required_text(info, "ELCTRN_BID_STT_NM"),
        },
        "buyer": {
            "organization_code": required_text(info, "PURR_CD"),
            "organization_name": required_text(info, "PURR_NM"),
        },
        "location": {
            "sido_code": optional_text(info, "SIDO_CD"),
            "sigungu_code": optional_text(info, "SIGUNGU_CD"),
            "eligibility_codes": list(_eligibility_codes(parsed)),
        },
        "schedule": {
            "announced_at": canonical_instant_text(info, "PBANC_YMD", "%Y%m%d"),
            "deadline_at": canonical_instant_text(
                info, "BID_END_DT", "%Y%m%d%H%M%S"
            ),
            "opened_at": canonical_instant_text(info, "OPNG_DT", "%Y%m%d%H%M%S"),
        },
        "pricing": {
            "base_amount": _money_fields(info, "BGNG_PRC"),
            "planned_amount": _money_fields(info, "ELCTRN_BID_PLNPRC"),
        },
        "classification": {
            "source_category_label": source_category,
            "category_source": (
                "source_field" if source_category is not None else "unknown"
            ),
        },
    }


def _money_fields(row: Mapping[str, str], field: str) -> dict[str, str] | None:
    amount = canonical_money_amount(row, field)
    return {"amount": amount, "currency": "KRW"} if amount is not None else None


def _build_v2(
    parsed: ParsedNexacro,
    info: Mapping[str, str],
    shared: dict[str, Any],
    *,
    observe_area_labels: bool,
) -> EatbidIngestionAuctionV2:
    roster = parse_bid_roster(parsed)
    if observe_area_labels:
        # 키를 아예 쓰지 않는 것과 빈 목록을 쓰는 것은 다른 사실이다. 전자는 "이 version은 라벨을 보지
        # 않았다", 후자는 "참가제한지역이 없는 공고"이며 canonical 바이트도 그 차이를 그대로 남긴다.
        shared = {
            **shared,
            "location": {
                **shared["location"],
                "eligibility_areas": list(_eligibility_areas(parsed)),
            },
        }
    return EatbidIngestionAuctionV2(
        contract_version="eatbid.ingestion.auction.v2",
        **shared,
        terms=parse_auction_terms(info),
        roster=roster,
        award=parse_award_decision(parsed, roster),
        reserve_price_draw=parse_reserve_price_draw(parsed),
        lineage=parse_lineage(parsed, info),
    )


def _contract_fingerprint(
    parsed: ParsedNexacro, schema: ReviewedSchemaContract
) -> str:
    """지문 규칙 자체는 계약이 갖는다. 여기서 다시 적으면 코드목록 경계와 상세 경계가 "같은 응답을
    같은 지문으로 부른다"는 사실을 각자 주장하게 된다."""
    return schema.observed_fingerprint(parsed.datasets)


def canonical_record_object(record: NormalizedAuctionRecord) -> dict[str, Any]:
    """canonical JSON의 객체 모양이다. 재직렬화 규칙의 단일 권위이며 투영도 이것으로 되읽는다.

    `exclude_unset`인 이유: canonical 바이트는 producer가 쓴 키의 함수여야 봉인된 payload가 계약의
    optional 가산 확장에 흔들리지 않는다. 모든 키를 내면 `eligibilityAreas`가 생긴 날 그 키를 모르던
    v2 payload가 전부 "canonical이 아님"이 된다(ADR 0038). 필수 필드는 언제나 set이므로 v1과 라벨 이전
    v2의 바이트는 이 규칙에서도 그대로다.
    """
    if not isinstance(record, (EatbidIngestionAuctionV1, EatbidIngestionAuctionV2)):
        raise TypeError("record must be a normalized eaT auction record")
    return record.model_dump(mode="json", by_alias=True, exclude_unset=True)


def canonical_payload(record: NormalizedAuctionRecord) -> bytes:
    return json.dumps(
        canonical_record_object(record),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _eligibility_codes(parsed: ParsedNexacro) -> tuple[str, ...]:
    codes: list[str] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        code = required_text(row, ELIGIBILITY_AREA.source_column)
        if code in codes:
            raise ValueError("duplicate PDLC_CD in ds_areaList")
        codes.append(code)
    return tuple(codes)


def _eligibility_areas(parsed: ParsedNexacro) -> tuple[SourceCodedValue, ...]:
    """`eligibilityCodes`와 같은 행 순서로 `(코드, 라벨)` 관측을 만든다.

    라벨은 `PDLC_NM` 원문 그대로다(`서울 / 전체`의 공백도 남긴다). 대조용 정규화는 매핑 생성기의
    규칙이지 관측의 일부가 아니며, 여기서 다듬으면 "소스가 이 이름으로 불렀다"는 증거가 사라진다
    (AGENTS 3, ADR 0035 §라벨 정규화의 범위). 라벨이 빈 행은 코드만 남고 실패가 아니다.
    """
    areas: list[SourceCodedValue] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        area = optional_scheme_value(row, ELIGIBILITY_AREA)
        if area is None:
            raise ValueError("PDLC_CD is required")
        areas.append(area)
    return tuple(areas)
