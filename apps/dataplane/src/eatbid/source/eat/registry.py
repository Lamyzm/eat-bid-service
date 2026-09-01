"""모듈 책임: 검토된 eaT endpoint와 입력·응답 계약만 immutable registry로 공개한다."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from eatbid.errors import SourceContractError
from eatbid.source.eat.payload import build_bid_detail_payload, build_bid_list_payload
from eatbid.source.eat.schema_contract import (
    ReviewedSchemaContract,
    reviewed_schema_contract,
)

EAT_ORIGIN = "https://ns.eat.co.kr"
BID_LIST_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
BID_DETAIL_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

PayloadBuilder = Callable[[Mapping[str, str]], bytes]


@dataclass(frozen=True, slots=True)
class EatEndpointContract:
    endpoint: str
    origin: str
    path: str
    method: str
    max_response_bytes: int
    schema_contract: ReviewedSchemaContract
    _payload_builder: PayloadBuilder = field(repr=False, compare=False)

    @property
    def parser_version(self) -> str:
        return self.schema_contract.parser_version

    @property
    def schema_fingerprint(self) -> str:
        return self.schema_contract.fingerprint

    @property
    def response_datasets(self) -> tuple[str, ...]:
        return tuple(self.schema_contract.datasets)

    @property
    def datasets(self) -> Mapping[str, tuple[str, ...]]:
        return self.schema_contract.datasets

    def build_payload(self, params: Mapping[str, str]) -> bytes:
        return self._payload_builder(params)


def _require_schema(endpoint: str) -> ReviewedSchemaContract:
    contract = reviewed_schema_contract(
        source="eat", endpoint=endpoint, parser_version="eat-v1"
    )
    if contract is None:  # pragma: no cover - import-time invariant
        raise RuntimeError(f"reviewed {endpoint} schema contract is required")
    return contract


_BID_LIST_SCHEMA = _require_schema("bid-list")
_BID_DETAIL_SCHEMA = _require_schema("bid-detail")

EAT_ENDPOINTS: Mapping[str, EatEndpointContract] = MappingProxyType(
    {
        _BID_LIST_SCHEMA.endpoint: EatEndpointContract(
            endpoint=_BID_LIST_SCHEMA.endpoint,
            origin=EAT_ORIGIN,
            path="/nm/ep/600/selectTmBidMBidPbancList.do",
            method="POST",
            max_response_bytes=BID_LIST_MAX_RESPONSE_BYTES,
            schema_contract=_BID_LIST_SCHEMA,
            _payload_builder=build_bid_list_payload,
        ),
        _BID_DETAIL_SCHEMA.endpoint: EatEndpointContract(
            endpoint=_BID_DETAIL_SCHEMA.endpoint,
            origin=EAT_ORIGIN,
            path="/nm/ep/600/selectBidDtl.do",
            method="POST",
            max_response_bytes=BID_DETAIL_MAX_RESPONSE_BYTES,
            schema_contract=_BID_DETAIL_SCHEMA,
            _payload_builder=build_bid_detail_payload,
        ),
    }
)


def require(endpoint: str) -> EatEndpointContract:
    contract = EAT_ENDPOINTS.get(endpoint)
    if contract is None:
        raise SourceContractError(f"eaT unknown-endpoint [endpoint={endpoint}]")
    return contract
