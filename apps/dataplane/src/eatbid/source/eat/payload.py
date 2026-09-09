"""모듈 책임: 검토된 eaT 입력만 Nexacro XML dataset으로 안전하게 직렬화한다."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date
from types import MappingProxyType
from xml.etree import ElementTree

from eatbid.failures.errors import SourceContractError
from eatbid.source.eat.xml import NEXACRO_DATASET_NAMESPACE

_ASCII_DATE = re.compile(r"[0-9]{8}")
_POSITIVE_DECIMAL = re.compile(r"[1-9][0-9]*")
MAX_START_PAGE_NUMBER = 1_000_000
MAX_PAGE_SIZE_ROWS = 1_000
MAX_ELECTRONIC_BID_ID_DIGITS = 20
_PROGRESS_CODES = frozenset(
    {
        "",
        "001",
        "003",
        "004",
        "005",
        "006",
        "007",
        "008",
        "009",
        "011",
        "012",
        "013",
        "999",
    }
)
_REGION_CODES = frozenset(
    {
        "",
        "1",
        "2",
        "3",
        "4",
        "6",
        "7",
        "8",
        "9",
        "10",
        "11",
        "12",
        "14",
        "15",
        "16",
        "17",
        "18",
    }
)
_TRANSACTION_FIELDS = {
    "STM_ID": "NEAT",
    "MENU_ID": "80015",
    "MENU_NO": "8060300",
    "PRGRM_ID": "EPTM610M01",
    "POPUP_YN": "N",
}
_LIST_FIELDS = frozenset(
    {
        "P_BID_BGNG_DT",
        "P_BID_END_DT",
        "P_PRGRS_STAT_CD",
        "P_CTPV_CD",
        "START_PAGE",
        "PAGE_SIZE",
    }
)
_DETAIL_FIELDS = frozenset({"ELCTRN_BID_ID"})


def build_bid_list_page_params(
    *,
    start_date: str,
    end_date: str,
    progress_status_code: str,
    region_code: str,
    page_number: int,
    page_size: int,
) -> Mapping[str, str]:
    """왜: 호출자가 Nexacro field 이름을 복제하지 않고 검토된 입력 계약을 소비한다."""
    params = {
        "P_BID_BGNG_DT": start_date,
        "P_BID_END_DT": end_date,
        "P_PRGRS_STAT_CD": progress_status_code,
        "P_CTPV_CD": region_code,
        "START_PAGE": str(page_number),
        "PAGE_SIZE": str(page_size),
    }
    # payload validator를 먼저 통과시켜 반환된 mapping 자체가 항상 전송 가능하게 한다.
    build_bid_list_payload(params)
    return MappingProxyType(params)


def build_bid_detail_params(external_bid_id: str) -> Mapping[str, str]:
    params = {"ELCTRN_BID_ID": external_bid_id}
    build_bid_detail_payload(params)
    return MappingProxyType(params)


def _invalid(endpoint: str) -> SourceContractError:
    return SourceContractError(f"eaT invalid-params [endpoint={endpoint}]")


def _require_exact_fields(
    endpoint: str, params: Mapping[str, str], expected: frozenset[str]
) -> None:
    if not isinstance(params, Mapping) or set(params) != expected:
        raise _invalid(endpoint)
    if any(not isinstance(value, str) for value in params.values()):
        raise _invalid(endpoint)


def _is_calendar_date(value: str) -> bool:
    if _ASCII_DATE.fullmatch(value) is None:
        return False
    try:
        date.fromisoformat(f"{value[:4]}-{value[4:6]}-{value[6:]}")
    except ValueError:
        return False
    return True


def _is_canonical_positive_at_most(value: str, maximum: int) -> bool:
    if _POSITIVE_DECIMAL.fullmatch(value) is None:
        return False
    if len(value) > len(str(maximum)):
        return False
    return int(value) <= maximum


def _dataset(
    root: ElementTree.Element,
    dataset_id: str,
    fields: Mapping[str, str],
    *,
    column_size: str,
) -> None:
    dataset = ElementTree.SubElement(root, "Dataset", {"id": dataset_id})
    column_info = ElementTree.SubElement(dataset, "ColumnInfo")
    for field_name in fields:
        ElementTree.SubElement(
            column_info,
            "Column",
            {"id": field_name, "type": "STRING", "size": column_size},
        )
    row = ElementTree.SubElement(ElementTree.SubElement(dataset, "Rows"), "Row")
    for field_name, value in fields.items():
        column = ElementTree.SubElement(row, "Col", {"id": field_name})
        column.text = value


def _envelope(datasets: tuple[tuple[str, Mapping[str, str], str], ...]) -> bytes:
    ElementTree.register_namespace("", NEXACRO_DATASET_NAMESPACE)
    root = ElementTree.Element(f"{{{NEXACRO_DATASET_NAMESPACE}}}Root")
    ElementTree.SubElement(root, "Parameters")
    for dataset_id, fields, column_size in datasets:
        _dataset(root, dataset_id, fields, column_size=column_size)
    return ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)


def build_bid_list_payload(params: Mapping[str, str]) -> bytes:
    _require_exact_fields("bid-list", params, _LIST_FIELDS)
    start_date = params["P_BID_BGNG_DT"]
    end_date = params["P_BID_END_DT"]
    if (
        not _is_calendar_date(start_date)
        or not _is_calendar_date(end_date)
        or start_date > end_date
        or params["P_PRGRS_STAT_CD"] not in _PROGRESS_CODES
        or params["P_CTPV_CD"] not in _REGION_CODES
        or not _is_canonical_positive_at_most(
            params["START_PAGE"], MAX_START_PAGE_NUMBER
        )
        or not _is_canonical_positive_at_most(params["PAGE_SIZE"], MAX_PAGE_SIZE_ROWS)
    ):
        raise _invalid("bid-list")

    # 빈 상태와 빈 지역은 각각 전체 상태와 전국이라는 원본 질의 의미를 보존한다.
    search_fields = {
        "P_BID_NM": "",
        "P_BID_BGNG_DT": params["P_BID_BGNG_DT"],
        "P_BID_END_DT": params["P_BID_END_DT"],
        "P_PRGRS_STAT_CD": params["P_PRGRS_STAT_CD"],
        "P_CTPV_CD": params["P_CTPV_CD"],
        "P_SGG_CD": "",
    }
    paging_fields = {
        "START_PAGE": params["START_PAGE"],
        "PAGE_SIZE": params["PAGE_SIZE"],
    }
    return _envelope(
        (
            ("ds_searchParam", search_fields, "256"),
            ("_ds_pagingInfo", paging_fields, "255"),
            ("_ds_tranInfo", _TRANSACTION_FIELDS, "255"),
        )
    )


def build_bid_detail_payload(params: Mapping[str, str]) -> bytes:
    _require_exact_fields("bid-detail", params, _DETAIL_FIELDS)
    bid_id = params["ELCTRN_BID_ID"]
    if (
        _POSITIVE_DECIMAL.fullmatch(bid_id) is None
        or len(bid_id) > MAX_ELECTRONIC_BID_ID_DIGITS
    ):
        raise _invalid("bid-detail")

    # 목록의 ETN_BID_ID를 받지 않고 상세 API가 실제로 요구한 이름만 경계에 남긴다.
    search_fields = {"ELCTRN_BID_ID": bid_id, "ACT_TYPE": "", "SUCBID_RSN": ""}
    return _envelope(
        (
            ("ds_searchParam", search_fields, "256"),
            ("_ds_tranInfo", _TRANSACTION_FIELDS, "255"),
        )
    )
