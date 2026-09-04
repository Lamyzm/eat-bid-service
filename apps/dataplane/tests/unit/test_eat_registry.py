from __future__ import annotations

from types import MappingProxyType
from xml.etree import ElementTree

import pytest

from eatbid.errors import SourceContractError
from eatbid.source.eat.registry import (
    EAT_ENDPOINT_TRANSPORTS,
    require,
    require_transport,
)
from eatbid.source.eat.schema_contract import (
    reviewed_schema_contract,
    reviewed_schema_fingerprint,
)

NS = {"d": "http://www.nexacroplatform.com/platform/dataset"}

# 봉인된 v1 발행물이 기대하는 상세 fingerprint다. eat-v2 추가와 v1 column 상수 추출이 이 값을
# 건드리지 않았다는 것을 회귀로 고정한다.
SEALED_V1_DETAIL_FINGERPRINT = (
    "c5270779844ac60244d94d852db2547cd42c47548dd4189d55f8f7a4e3c94adf"
)


def _dataset_row(payload: bytes, dataset_id: str) -> dict[str, str]:
    root = ElementTree.fromstring(payload)
    dataset = root.find(f"d:Dataset[@id='{dataset_id}']", NS)
    assert dataset is not None
    return {
        column.attrib["id"]: column.text or ""
        for column in dataset.findall("d:Rows/d:Row/d:Col", NS)
    }


def test_registry는_검토된_비로그인_endpoint_둘만_노출한다() -> None:
    transports = EAT_ENDPOINT_TRANSPORTS
    assert isinstance(transports, MappingProxyType)
    assert set(transports) == {"bid-list", "bid-detail"}
    assert {transport.path for transport in transports.values()} == {
        "/nm/ep/600/selectTmBidMBidPbancList.do",
        "/nm/ep/600/selectBidDtl.do",
    }
    assert all(
        transport.origin == "https://ns.eat.co.kr" for transport in transports.values()
    )
    assert all(transport.method == "POST" for transport in transports.values())
    assert all(
        not transport.path.startswith("/ep/") for transport in transports.values()
    )


def test_registry는_미검토_endpoint를_fail_closed한다() -> None:
    with pytest.raises(SourceContractError, match="unknown-endpoint"):
        require_transport("contract-list")
    with pytest.raises(SourceContractError, match="unknown-endpoint"):
        require("contract-list", parser_version="eat-v1")


def test_두_parser_version이_같은_transport와_다른_record_type을_쓴다() -> None:
    v1 = require("bid-detail", parser_version="eat-v1")
    v2 = require("bid-detail", parser_version="eat-v2")

    assert v1.transport is v2.transport
    assert v1.path == v2.path
    assert v1.origin == v2.origin
    assert v1.max_response_bytes == v2.max_response_bytes
    assert v1.record_type == "auction.v1"
    assert v2.record_type == "auction.v2"


def test_목록_record_type은_두_parser_version에서_같다() -> None:
    v1 = require("bid-list", parser_version="eat-v1")
    v2 = require("bid-list", parser_version="eat-v2")

    assert v1.record_type == v2.record_type == "auction-discovery.v1"
    assert v1.schema_fingerprint == v2.schema_fingerprint
    assert v1.datasets == v2.datasets


def test_eat_v2가_v1_필수_부분집합과_fingerprint를_공유한다() -> None:
    v1 = reviewed_schema_contract(
        source="eat", endpoint="bid-detail", parser_version="eat-v1"
    )
    v2 = reviewed_schema_contract(
        source="eat", endpoint="bid-detail", parser_version="eat-v2"
    )

    assert v1 is not None and v2 is not None
    # 계약이 주장하는 것은 필수 부분집합의 존재이며 그것은 두 버전에서 같다. 달라진 것은 해석 깊이다.
    assert v1.required_datasets == v2.required_datasets
    assert v1.fingerprint == v2.fingerprint == SEALED_V1_DETAIL_FINGERPRINT
    assert set(v2.datasets) == {
        "ds_info",
        "ds_areaList",
        "ds_bidList",
        "ds_pList",
        "ds_bidHistory",
    }


def test_eat_v2_상세_계약이_실측된_명단_column_수를_고정한다() -> None:
    contract = require("bid-detail", parser_version="eat-v2")

    assert len(contract.datasets["ds_bidList"]) == 55
    assert len(contract.datasets["ds_pList"]) == 5
    assert len(contract.datasets["ds_bidHistory"]) == 34
    assert len(contract.datasets["ds_info"]) == 21
    assert "SUCBID_DCSN_MTH_CD" in contract.datasets["ds_info"]
    assert {"RNK", "BID_CALC_AMT", "SAJEONG_PCT", "BIZ_NO", "DRAW_NO"} <= set(
        contract.datasets["ds_bidList"]
    )
    assert set(contract.datasets["ds_pList"]) == {
        "CHC_YN",
        "CMNM_PLNPRC",
        "CMNM_PLNPRC_RT",
        "CMNM_PLNPRC_SN",
        "ELCTRN_BID_ID",
    }


def test_모르는_parser_version은_계약을_주지_않는다() -> None:
    with pytest.raises(SourceContractError, match="unknown-parser-version"):
        require("bid-detail", parser_version="eat-v9")
    with pytest.raises(SourceContractError, match="unknown-parser-version"):
        require("bid-list", parser_version="eat-v9")


def test_bid_detail_registry는_schema_fingerprint_권위를_재사용한다() -> None:
    contract = require("bid-detail", parser_version="eat-v1")

    assert contract.parser_version == "eat-v1"
    assert contract.schema_fingerprint == reviewed_schema_fingerprint(
        source="eat", endpoint="bid-detail", parser_version="eat-v1"
    )
    assert contract.schema_fingerprint == SEALED_V1_DETAIL_FINGERPRINT
    assert set(contract.response_datasets) == {"ds_info", "ds_areaList"}
    assert contract.datasets["ds_info"] == (
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
    )


def test_bid_list_registry는_release_plan용_schema_metadata를_직접_노출한다() -> None:
    contract = require("bid-list", parser_version="eat-v1")

    assert contract.endpoint == "bid-list"
    assert contract.parser_version == "eat-v1"
    assert contract.schema_fingerprint == (
        "37ae3b110f15ac1099f916d9f08f4ca965a6d4e8f17b6893e94ca604cd9e1d01"
    )
    assert contract.response_datasets == ("ds_list",)
    assert len(contract.datasets["ds_list"]) == 38
    assert set(contract.schema_contract.required_datasets["ds_list"]) == {
        "TOT_CNT", "ETN_BID_ID", "BID_CNT", "ETN_BID_STT_NM", "BID_END_DT", "LAST_CHG_DT"
    }
    assert contract.record_type == "auction-discovery.v1"
    assert contract.schema_fingerprint == reviewed_schema_fingerprint(
        source="eat", endpoint="bid-list", parser_version="eat-v1"
    )


def test_bid_list_registry가_page_parameter_이름을_한곳에서_조립한다() -> None:
    params = require_transport("bid-list").build_page_params(
        start_date="20260901",
        end_date="20260902",
        progress_status_code="",
        region_code="1",
        page_number=2,
        page_size=100,
    )

    assert dict(params) == {
        "P_BID_BGNG_DT": "20260901",
        "P_BID_END_DT": "20260902",
        "P_PRGRS_STAT_CD": "",
        "P_CTPV_CD": "1",
        "START_PAGE": "2",
        "PAGE_SIZE": "100",
    }


def test_bid_list_payload는_검토된_variable과_fixed_dataset만_조립한다() -> None:
    payload = require_transport("bid-list").build_payload(
        {
            "P_BID_BGNG_DT": "20260801",
            "P_BID_END_DT": "20260831",
            "P_PRGRS_STAT_CD": "",
            "P_CTPV_CD": "",
            "START_PAGE": "1",
            "PAGE_SIZE": "30",
        }
    )

    assert _dataset_row(payload, "ds_searchParam") == {
        "P_BID_NM": "",
        "P_BID_BGNG_DT": "20260801",
        "P_BID_END_DT": "20260831",
        "P_PRGRS_STAT_CD": "",
        "P_CTPV_CD": "",
        "P_SGG_CD": "",
    }
    assert _dataset_row(payload, "_ds_pagingInfo") == {
        "START_PAGE": "1",
        "PAGE_SIZE": "30",
    }
    assert _dataset_row(payload, "_ds_tranInfo") == {
        "STM_ID": "NEAT",
        "MENU_ID": "80015",
        "MENU_NO": "8060300",
        "PRGRM_ID": "EPTM610M01",
        "POPUP_YN": "N",
    }


def test_bid_detail_payload는_목록_ID_이름을_상세_ID_필드로_추론하지_않는다() -> None:
    payload = require_transport("bid-detail").build_payload({"ELCTRN_BID_ID": "5291468"})

    assert _dataset_row(payload, "ds_searchParam") == {
        "ELCTRN_BID_ID": "5291468",
        "ACT_TYPE": "",
        "SUCBID_RSN": "",
    }
    assert _dataset_row(payload, "_ds_tranInfo")["PRGRM_ID"] == "EPTM610M01"


@pytest.mark.parametrize(
    "invalid_id",
    [
        "",
        "0",
        "E230913-178198-0",
        "05291468",
        " 5291468",
        "5291468\n",
        "5291468\x00",
        "5291468\x01",
        '5291468</Col><Dataset id="escaped">&',
        "1" * 21,
    ],
)
def test_bid_detail_payload는_bounded_canonical_positive_ASCII_ID만_허용한다(
    invalid_id: str,
) -> None:
    with pytest.raises(SourceContractError, match="invalid-params"):
        require_transport("bid-detail").build_payload({"ELCTRN_BID_ID": invalid_id})


@pytest.mark.parametrize(
    ("endpoint", "params"),
    [
        ("bid-detail", {}),
        ("bid-detail", {"ELCTRN_BID_ID": "1", "URL": "https://evil.example"}),
        ("bid-detail", {"ETN_BID_ID": "5291468"}),
        ("bid-detail", {"ELCTRN_BID_ID": ""}),
        ("bid-list", {"P_BID_BGNG_DT": "20260801"}),
        (
            "bid-list",
            {
                "P_BID_BGNG_DT": "20260801",
                "P_BID_END_DT": "20260831",
                "P_PRGRS_STAT_CD": "007",
                "P_CTPV_CD": "1",
                "START_PAGE": "1",
                "PAGE_SIZE": "30",
                "headers": "Authorization: secret",
            },
        ),
    ],
)
def test_payload는_missing_extra_또는_잘못된_parameter_name을_거부한다(
    endpoint: str, params: dict[str, str]
) -> None:
    with pytest.raises(SourceContractError, match="invalid-params"):
        require_transport(endpoint).build_payload(params)


@pytest.mark.parametrize(
    ("field", "invalid"),
    [
        ("P_BID_BGNG_DT", "2026-08-01"),
        ("P_BID_BGNG_DT", "２０２６０８０１"),
        ("P_BID_END_DT", "20260230"),
        ("P_PRGRS_STAT_CD", "010"),
        ("P_CTPV_CD", "01"),
        ("P_CTPV_CD", "5"),
        ("P_CTPV_CD", "13"),
        ("START_PAGE", "0"),
        ("START_PAGE", "01"),
        ("START_PAGE", "1000001"),
        ("START_PAGE", "1" * 24),
        ("PAGE_SIZE", "+30"),
        ("PAGE_SIZE", "1001"),
    ],
)
def test_bid_list_payload는_검토된_source_text_contract만_허용한다(
    field: str, invalid: str
) -> None:
    params = {
        "P_BID_BGNG_DT": "20260801",
        "P_BID_END_DT": "20260831",
        "P_PRGRS_STAT_CD": "007",
        "P_CTPV_CD": "1",
        "START_PAGE": "1",
        "PAGE_SIZE": "30",
    }
    params[field] = invalid

    with pytest.raises(SourceContractError, match="invalid-params"):
        require_transport("bid-list").build_payload(params)


@pytest.mark.parametrize(
    ("field", "allowed"),
    [
        ("P_PRGRS_STAT_CD", ""),
        ("P_PRGRS_STAT_CD", "001"),
        ("P_PRGRS_STAT_CD", "999"),
        ("P_CTPV_CD", ""),
        ("P_CTPV_CD", "1"),
        ("P_CTPV_CD", "17"),
        ("P_CTPV_CD", "18"),
        ("START_PAGE", "1000000"),
        ("PAGE_SIZE", "1000"),
    ],
)
def test_bid_list_payload는_전체_상태와_전국_지역을_명시적으로_허용한다(
    field: str, allowed: str
) -> None:
    params = {
        "P_BID_BGNG_DT": "20260801",
        "P_BID_END_DT": "20260831",
        "P_PRGRS_STAT_CD": "007",
        "P_CTPV_CD": "1",
        "START_PAGE": "1",
        "PAGE_SIZE": "30",
    }
    params[field] = allowed

    require_transport("bid-list").build_payload(params)


def test_bid_list_payload는_시작일이_종료일보다_늦으면_거부한다() -> None:
    with pytest.raises(SourceContractError, match="invalid-params"):
        require_transport("bid-list").build_payload(
            {
                "P_BID_BGNG_DT": "20260901",
                "P_BID_END_DT": "20260831",
                "P_PRGRS_STAT_CD": "007",
                "P_CTPV_CD": "1",
                "START_PAGE": "1",
                "PAGE_SIZE": "1000",
            }
        )
