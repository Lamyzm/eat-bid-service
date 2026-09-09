"""모듈 책임: 검토된 eaT endpoint의 전송 경계와 parser version별 응답 계약을 나눠 공개한다."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType

from eatbid.failures.errors import SourceContractError
from eatbid.source.eat.payload import (
    build_bid_detail_params,
    build_bid_detail_payload,
    build_bid_list_page_params,
    build_bid_list_payload,
)
from eatbid.source.eat.schema_contract import (
    ReviewedSchemaContract,
    reviewed_schema_contract,
)

EAT_ORIGIN = "https://ns.eat.co.kr"
BID_LIST_MAX_RESPONSE_BYTES = 16 * 1024 * 1024
BID_DETAIL_MAX_RESPONSE_BYTES = 8 * 1024 * 1024

PayloadBuilder = Callable[[Mapping[str, str]], bytes]
PageParamsBuilder = Callable[..., Mapping[str, str]]


@dataclass(frozen=True, slots=True)
class EatEndpointTransport:
    """endpoint의 전송 경계다. parser version과 무관하며 응답 해석 방법을 모른다.

    왜 나누나. 요청을 보내는 쪽(HTTP client)은 어떤 계약으로 응답을 읽을지 알 필요가 없고, 응답을
    읽는 쪽만 parser version을 고른다. 한 몸으로 두면 capture 경로가 parser version을 들고 다니게 되어
    "어떤 계약으로 읽었는가"라는 사실이 요청 경계로 새어 나간다.
    """

    endpoint: str
    origin: str
    path: str
    method: str
    max_response_bytes: int
    _payload_builder: PayloadBuilder = field(repr=False, compare=False)
    _page_params_builder: PageParamsBuilder | None = field(
        default=None, repr=False, compare=False
    )

    def build_payload(self, params: Mapping[str, str]) -> bytes:
        return self._payload_builder(params)

    def build_page_params(
        self,
        *,
        start_date: str,
        end_date: str,
        progress_status_code: str,
        region_code: str,
        page_number: int,
        page_size: int,
    ) -> Mapping[str, str]:
        if self._page_params_builder is None:
            raise SourceContractError(
                f"eaT endpoint is not pageable [endpoint={self.endpoint}]"
            )
        return self._page_params_builder(
            start_date=start_date,
            end_date=end_date,
            progress_status_code=progress_status_code,
            region_code=region_code,
            page_number=page_number,
            page_size=page_size,
        )

    def build_detail_params(self, external_bid_id: str) -> Mapping[str, str]:
        if self.endpoint != "bid-detail":
            raise SourceContractError(
                f"eaT endpoint is not detail [endpoint={self.endpoint}]"
            )
        return build_bid_detail_params(external_bid_id)


@dataclass(frozen=True, slots=True)
class EatEndpointContract:
    """전송 경계 하나와 그것을 읽는 parser version 하나의 짝이다."""

    transport: EatEndpointTransport
    schema_contract: ReviewedSchemaContract
    record_type: str

    @property
    def endpoint(self) -> str:
        return self.transport.endpoint

    @property
    def origin(self) -> str:
        return self.transport.origin

    @property
    def path(self) -> str:
        return self.transport.path

    @property
    def method(self) -> str:
        return self.transport.method

    @property
    def max_response_bytes(self) -> int:
        return self.transport.max_response_bytes

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
        return self.transport.build_payload(params)

    def build_page_params(
        self,
        *,
        start_date: str,
        end_date: str,
        progress_status_code: str,
        region_code: str,
        page_number: int,
        page_size: int,
    ) -> Mapping[str, str]:
        return self.transport.build_page_params(
            start_date=start_date,
            end_date=end_date,
            progress_status_code=progress_status_code,
            region_code=region_code,
            page_number=page_number,
            page_size=page_size,
        )

    def build_detail_params(self, external_bid_id: str) -> Mapping[str, str]:
        return self.transport.build_detail_params(external_bid_id)


EAT_ENDPOINT_TRANSPORTS: Mapping[str, EatEndpointTransport] = MappingProxyType(
    {
        "bid-list": EatEndpointTransport(
            endpoint="bid-list",
            origin=EAT_ORIGIN,
            path="/nm/ep/600/selectTmBidMBidPbancList.do",
            method="POST",
            max_response_bytes=BID_LIST_MAX_RESPONSE_BYTES,
            _payload_builder=build_bid_list_payload,
            _page_params_builder=build_bid_list_page_params,
        ),
        "bid-detail": EatEndpointTransport(
            endpoint="bid-detail",
            origin=EAT_ORIGIN,
            path="/nm/ep/600/selectBidDtl.do",
            method="POST",
            max_response_bytes=BID_DETAIL_MAX_RESPONSE_BYTES,
            _payload_builder=build_bid_detail_payload,
        ),
    }
)

# 목록 record_type이 세 parser version에서 같은 이유는 eat-v2·eat-v3가 목록 응답의 해석을 바꾸지 않기
# 때문이다. v2에서 깊어진 것은 상세 해석뿐이므로 목록 정규화 결과의 이름을 바꾸면 같은 사실에 두 이름이
# 생긴다. 상세만 `auction.v2`로 갈라진다. eat-v3 상세도 `auction.v2`다 — 라벨은 그 계약의 가산 optional
# 필드이지 새 record type이 아니며(ADR 0038), 이름을 가르면 발행 가능 목록·빌더·topology 검사가 같은
# 계약에 두 이름을 갖게 된다.
_RECORD_TYPES: Mapping[tuple[str, str], str] = MappingProxyType(
    {
        ("bid-list", "eat-v1"): "auction-discovery.v1",
        ("bid-list", "eat-v2"): "auction-discovery.v1",
        ("bid-list", "eat-v3"): "auction-discovery.v1",
        ("bid-detail", "eat-v1"): "auction.v1",
        ("bid-detail", "eat-v2"): "auction.v2",
        ("bid-detail", "eat-v3"): "auction.v2",
    }
)


def require_transport(endpoint: str) -> EatEndpointTransport:
    transport = EAT_ENDPOINT_TRANSPORTS.get(endpoint)
    if transport is None:
        raise SourceContractError(f"eaT unknown-endpoint [endpoint={endpoint}]")
    return transport


def require(endpoint: str, *, parser_version: str) -> EatEndpointContract:
    """왜 parser version에 기본값을 두지 않나.

    기본값은 "어떤 계약으로 읽었는가"라는 사실을 호출부에서 지운다. 검토되지 않은 version은 계약을
    받지 못하고 fail-closed 되어야 하므로 호출부가 자기 실행 단위의 version을 매번 명시한다.
    """
    transport = require_transport(endpoint)
    schema = reviewed_schema_contract(
        source="eat", endpoint=endpoint, parser_version=parser_version
    )
    record_type = _RECORD_TYPES.get((endpoint, parser_version))
    if schema is None or record_type is None:
        raise SourceContractError(
            f"eaT unknown-parser-version "
            f"[endpoint={endpoint} parser_version={parser_version}]"
        )
    return EatEndpointContract(
        transport=transport, schema_contract=schema, record_type=record_type
    )
