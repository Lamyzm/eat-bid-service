"""모듈 책임: 검토된 eaT 응답 schema와 fingerprint의 단일 권위를 제공한다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from eatbid.source.eat.xml import schema_fingerprint


@dataclass(frozen=True, slots=True)
class ReviewedSchemaContract:
    source: str
    endpoint: str
    parser_version: str
    datasets: Mapping[str, tuple[str, ...]]

    @property
    def fingerprint(self) -> str:
        return schema_fingerprint(self.datasets)


_EAT_V1_BID_LIST = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-list",
    parser_version="eat-v1",
    datasets=MappingProxyType({"ds_list": ("TOT_CNT", "ETN_BID_ID")}),
)

_EAT_V1_BID_DETAIL = ReviewedSchemaContract(
    source="eat",
    endpoint="bid-detail",
    parser_version="eat-v1",
    datasets=MappingProxyType(
        {
            "ds_info": (
                "ELCTRN_BID_NO",
                "BID_NM",
                "ELCTRN_BID_STT_NM",
                "PURR_CD",
                "PURR_NM",
                "SIDO_CD",
                "SIGUNGU_CD",
                "PBANC_YMD",
                "BID_END_DT",
                "OPNG_DT",
                "BGNG_PRC",
                "ELCTRN_BID_PLNPRC",
                "MAIN_ITEMS",
            ),
            "ds_areaList": ("PDLC_CD",),
        }
    ),
)

REVIEWED_EAT_SCHEMA_CONTRACTS = MappingProxyType(
    {
        (contract.source, contract.endpoint, contract.parser_version): contract
        for contract in (_EAT_V1_BID_LIST, _EAT_V1_BID_DETAIL)
    }
)


def reviewed_schema_fingerprint(
    *, source: str, endpoint: str, parser_version: str
) -> str | None:
    contract = reviewed_schema_contract(
        source=source,
        endpoint=endpoint,
        parser_version=parser_version,
    )
    return contract.fingerprint if contract is not None else None


def reviewed_schema_contract(
    *, source: str, endpoint: str, parser_version: str
) -> ReviewedSchemaContract | None:
    return REVIEWED_EAT_SCHEMA_CONTRACTS.get((source, endpoint, parser_version))


def validate_eat_schema_contract(
    *,
    source: str,
    endpoint: str,
    parser_version: str,
    schema_fingerprint: str | None,
) -> bool:
    expected = reviewed_schema_fingerprint(
        source=source,
        endpoint=endpoint,
        parser_version=parser_version,
    )
    return expected is not None and schema_fingerprint == expected
