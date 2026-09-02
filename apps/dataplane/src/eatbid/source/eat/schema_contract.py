"""모듈 책임: 검토된 eaT 응답 schema와 fingerprint의 단일 권위를 제공한다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from types import MappingProxyType

from eatbid.source.eat.xml import schema_fingerprint


@dataclass(frozen=True, slots=True)
class ReviewedSchemaContract:
    """검토된 응답 schema. `datasets`는 파서가 아는 전체, `required`는 없으면 못 만드는 최소다.

    왜 둘로 나누나. 2026-09-03 실측에서 live 상세 응답은 공고 유형에 따라 dataset과 column이 붙거나
    빠져 같은 창 85건이 전체 모양 fingerprint를 12가지로 갈랐다. 전체 모양을 계약으로 삼으면 어떤
    live 수집도 발행되지 않는다. 계약이 지켜야 하는 것은 기본 사실을 만들 수 있느냐이므로 fingerprint는
    `required`로만 계산한다. 선택적 column의 부재나 모르는 column의 존재는 해석에 쓰지 않으므로
    추측을 들이지 않는다.
    """

    source: str
    endpoint: str
    parser_version: str
    datasets: Mapping[str, tuple[str, ...]]
    required: Mapping[str, tuple[str, ...]] | None = None

    @property
    def required_datasets(self) -> Mapping[str, tuple[str, ...]]:
        return self.datasets if self.required is None else self.required

    @property
    def fingerprint(self) -> str:
        return schema_fingerprint(self.required_datasets)


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
    # 파서가 `_required_text`로 읽는 넷이다. 나머지는 모두 nullable 값이라 없어도 canonical 사실을
    # 만들 수 있다. `ds_areaList`는 참가제한지역이 없는 공고가 있으므로 필수가 아니다.
    required=MappingProxyType(
        {
            "ds_info": (
                "BID_NM",
                "ELCTRN_BID_STT_NM",
                "PURR_CD",
                "PURR_NM",
            )
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
