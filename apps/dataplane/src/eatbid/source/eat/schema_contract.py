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
        (
            _EAT_V1_BID_DETAIL.source,
            _EAT_V1_BID_DETAIL.endpoint,
            _EAT_V1_BID_DETAIL.parser_version,
        ): _EAT_V1_BID_DETAIL
    }
)


def reviewed_schema_fingerprint(
    *, source: str, endpoint: str, parser_version: str
) -> str | None:
    contract = REVIEWED_EAT_SCHEMA_CONTRACTS.get(
        (source, endpoint, parser_version)
    )
    return contract.fingerprint if contract is not None else None


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
