"""모듈 책임: 검토된 eaT 상세 응답을 parser version이 고른 계약으로 정규화 공고 record로 조립한다."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from decimal import InvalidOperation
from types import MappingProxyType
from typing import Any

from pydantic import ValidationError

from eatbid.errors import SourceContractError
from eatbid.generated.ingestion_v1 import EatbidIngestionAuctionV1
from eatbid.generated.ingestion_v2 import EatbidIngestionAuctionV2
from eatbid.source.eat.auction_terms import parse_auction_terms
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
from eatbid.source.eat.xml import ParsedNexacro, parse_nexacro, schema_fingerprint


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
    {version: _require_detail_schema(version) for version in ("eat-v1", "eat-v2")}
)


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
            _build_v2(parsed, info, shared)
            if parser_version == "eat-v2"
            else EatbidIngestionAuctionV1(
                contract_version="eatbid.ingestion.auction.v1", **shared
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
    parsed: ParsedNexacro, info: Mapping[str, str], shared: dict[str, Any]
) -> EatbidIngestionAuctionV2:
    roster = parse_bid_roster(parsed)
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
            for dataset, required in schema.required_datasets.items()
        }
    )


def canonical_payload(record: NormalizedAuctionRecord) -> bytes:
    if not isinstance(record, (EatbidIngestionAuctionV1, EatbidIngestionAuctionV2)):
        raise TypeError("record must be a normalized eaT auction record")
    return json.dumps(
        record.model_dump(mode="json", by_alias=True),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def _eligibility_codes(parsed: ParsedNexacro) -> tuple[str, ...]:
    codes: list[str] = []
    for row in parsed.datasets.get("ds_areaList", ()):
        code = required_text(row, "PDLC_CD")
        if code in codes:
            raise ValueError("duplicate PDLC_CD in ds_areaList")
        codes.append(code)
    return tuple(codes)
