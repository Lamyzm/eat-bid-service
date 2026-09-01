from __future__ import annotations

from types import MappingProxyType
from xml.etree import ElementTree

import pytest

from eatbid.errors import SourceContractError
from eatbid.source.eat.registry import EAT_ENDPOINTS, require
from eatbid.source.eat.schema_contract import reviewed_schema_fingerprint

NS = {"d": "http://www.nexacroplatform.com/platform/dataset"}


def _dataset_row(payload: bytes, dataset_id: str) -> dict[str, str]:
    root = ElementTree.fromstring(payload)
    dataset = root.find(f"d:Dataset[@id='{dataset_id}']", NS)
    assert dataset is not None
    return {
        column.attrib["id"]: column.text or ""
        for column in dataset.findall("d:Rows/d:Row/d:Col", NS)
    }


def test_registry는_검토된_비로그인_endpoint_둘만_노출한다() -> None:
    assert isinstance(EAT_ENDPOINTS, MappingProxyType)
    assert set(EAT_ENDPOINTS) == {"bid-list", "bid-detail"}
    assert {contract.path for contract in EAT_ENDPOINTS.values()} == {
        "/nm/ep/600/selectTmBidMBidPbancList.do",
        "/nm/ep/600/selectBidDtl.do",
    }
    assert all(
        contract.origin == "https://ns.eat.co.kr" for contract in EAT_ENDPOINTS.values()
    )
    assert all(contract.method == "POST" for contract in EAT_ENDPOINTS.values())
    assert all(
        not contract.path.startswith("/ep/") for contract in EAT_ENDPOINTS.values()
    )


def test_registry는_미검토_endpoint를_fail_closed한다() -> None:
    with pytest.raises(SourceContractError, match="unknown-endpoint"):
        require("contract-list")


def test_bid_detail_registry는_schema_fingerprint_권위를_재사용한다() -> None:
    contract = require("bid-detail")

    assert contract.parser_version == "eat-v1"
    assert contract.schema_fingerprint == reviewed_schema_fingerprint(
        source="eat", endpoint="bid-detail", parser_version="eat-v1"
    )
    assert set(contract.response_datasets) == {"ds_info", "ds_areaList"}


def test_bid_list_registry는_release_plan용_schema_metadata를_직접_노출한다() -> None:
    contract = require("bid-list")

    assert contract.endpoint == "bid-list"
    assert contract.parser_version == "eat-v1"
    assert contract.schema_fingerprint == (
        "f316b1c240ecd53c8c0a8927ad7f8d5fef437ce615684c404650dae5f03b3701"
    )
    assert contract.response_datasets == ("ds_list",)
    assert contract.datasets == {"ds_list": ("TOT_CNT", "ETN_BID_ID")}
    assert contract.record_type == "auction-discovery.v1"
    assert contract.schema_fingerprint == reviewed_schema_fingerprint(
        source="eat", endpoint="bid-list", parser_version="eat-v1"
    )


def test_bid_list_registry가_page_parameter_이름을_한곳에서_조립한다() -> None:
    params = require("bid-list").build_page_params(
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
    payload = require("bid-list").build_payload(
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
    payload = require("bid-detail").build_payload({"ELCTRN_BID_ID": "5291468"})

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
        require("bid-detail").build_payload({"ELCTRN_BID_ID": invalid_id})


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
        require(endpoint).build_payload(params)


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
        require("bid-list").build_payload(params)


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

    require("bid-list").build_payload(params)


def test_bid_list_payload는_시작일이_종료일보다_늦으면_거부한다() -> None:
    with pytest.raises(SourceContractError, match="invalid-params"):
        require("bid-list").build_payload(
            {
                "P_BID_BGNG_DT": "20260901",
                "P_BID_END_DT": "20260831",
                "P_PRGRS_STAT_CD": "007",
                "P_CTPV_CD": "1",
                "START_PAGE": "1",
                "PAGE_SIZE": "1000",
            }
        )
