"""모듈 책임: `apps/dataplane/scripts/pseudonymize_eat_detail_fixture.py`의 가명화 규칙을 단위로
고정한다. 순수 함수 `pseudonymize_business_id`(사업자번호 형식·결정론)와 `resolve_bid_name`(재입찰
접미사 보존) 두 개, 그리고 이 둘을 실제로 쓰는 `_pseudonymize_bid_list`/`_pseudonymize_bid_history`가
최소 XML 문서 위에서 같은 성질(형식 유지·재현성·행별 접미사 보존)을 지키는지 검증한다. 이 스크립트는
`eatbid` 패키지 밖의 독립 실행 파일이라 파일 경로로 직접 불러온다.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType
from xml.etree import ElementTree

SCRIPT_PATH = (
    Path(__file__).parents[2] / "scripts" / "pseudonymize_eat_detail_fixture.py"
)


def _load_script_module() -> ModuleType:
    spec = importlib.util.spec_from_file_location(
        "pseudonymize_eat_detail_fixture", SCRIPT_PATH
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script_module()
NS = script.NS


def _bid_list_root(*rows: dict[str, str]) -> ElementTree.Element:
    """`ds_bidList` 하나짜리 최소 Nexacro 문서를 만든다. row는 원본 column 값 dict다."""
    cells = "".join(
        "<Row>" + "".join(f'<Col id="{key}">{value}</Col>' for key, value in row.items()) + "</Row>"
        for row in rows
    )
    xml = f'<Root xmlns="{NS}"><Dataset id="ds_bidList"><Rows>{cells}</Rows></Dataset></Root>'
    return ElementTree.fromstring(xml)


def _bid_history_root(*bid_nm_values: str) -> ElementTree.Element:
    """`ds_bidHistory` 하나짜리 최소 Nexacro 문서를 만든다. 행마다 원본 `BID_NM` 하나만 준다."""
    cells = "".join(f"<Row><Col id=\"BID_NM\">{value}</Col></Row>" for value in bid_nm_values)
    xml = f'<Root xmlns="{NS}"><Dataset id="ds_bidHistory"><Rows>{cells}</Rows></Dataset></Root>'
    return ElementTree.fromstring(xml)


def test_pseudonymize_business_id가_10자리_숫자_형식을_유지하며_행_인덱스마다_다른_값을_낸다() -> None:
    first = script.pseudonymize_business_id(0, 1_000_000_000)
    second = script.pseudonymize_business_id(1, 1_000_000_000)

    assert len(first) == 10
    assert first.isdigit()
    assert first != second
    assert script.pseudonymize_business_id(0, 1_000_000_000) == first  # 결정론적
    # offset을 fixture마다 다르게 주면 같은 인덱스라도 값이 겹치지 않는다.
    assert script.pseudonymize_business_id(0, 2_000_000_000) != first


def test_resolve_bid_name이_재입찰_접미사_유무를_원본_그대로_보존한다() -> None:
    # 실제 레이크 기관명이 아니라 합성 문자열이다 — fixture에서 가명화한 값을 테스트가 되살리면 안 된다.
    original_with_suffix = "10월 가명초, 가명중 급식재료 종합계약 소액수의 견적 공고 [재입찰]"
    original_without_suffix = "10월 가명초, 가명중 급식재료 종합계약 소액수의 견적 공고"

    assert script.resolve_bid_name(original_with_suffix) == script.BID_NM_REBID_PLACEHOLDER
    assert script.resolve_bid_name(original_without_suffix) == script.BID_NM_PLACEHOLDER
    # 값이 없는 행(Col 요소 자체가 없어 text가 None인 경우)도 접미사 없음으로 처리해 예외 없이 처리한다.
    assert script.resolve_bid_name(None) == script.BID_NM_PLACEHOLDER


def test_bid_list_가명_치환이_결정론적이며_형식을_유지하고_같은_원본_행에_같은_가명을_준다() -> None:
    pseudonym = script._bid_list_pseudonym(
        biz_no_offset=1_000_000_000, shipper_cd_offset=200_000, sgnng_id_offset=100_000_000
    )
    # 실제 레이크 사업자번호·업체명이 아니라 합성 원본이다 — 형식만 실제 값과 같다.
    row = {"BIZ_NO": "0000000001", "SHIPPER_BRNO": "0000000001", "SHIPPER_NM": "합성업체"}

    first_run = _bid_list_root(row)
    script._pseudonymize_bid_list(first_run, pseudonym)
    (first_row,) = script._rows(script._dataset(first_run, "ds_bidList"))
    first_values = {col.get("id"): col.text for col in first_row.findall(f"{{{NS}}}Col")}

    # 같은 원본 행을 처음부터 다시 파싱해 독립적으로 한 번 더 치환해도 같은 가명이 나와야 한다
    # (행 순서·offset이 같으면 재실행 결과가 재현된다).
    second_run = _bid_list_root(row)
    script._pseudonymize_bid_list(second_run, pseudonym)
    (second_row,) = script._rows(script._dataset(second_run, "ds_bidList"))
    second_values = {col.get("id"): col.text for col in second_row.findall(f"{{{NS}}}Col")}

    assert first_values == second_values
    assert first_values["BIZ_NO"] != row["BIZ_NO"]  # 원본 사업자번호가 남지 않았다
    assert first_values["BIZ_NO"] == first_values["SHIPPER_BRNO"]  # 같은 업체는 같은 가명 사업자번호
    assert len(first_values["BIZ_NO"]) == 10 and first_values["BIZ_NO"].isdigit()  # 자릿수 형식 유지
    assert first_values["SHIPPER_NM"] == "비식별 업체 1"


def test_pseudonymize_bid_history가_재입찰_접미사_유무를_행별로_원본대로_보존한다() -> None:
    # 실제 레이크 기관명이 아니라 합성 문자열이다 — fixture에서 가명화한 값을 테스트가 되살리면 안 된다.
    root = _bid_history_root(
        "10월 가명초, 가명중 급식재료 종합계약 소액수의 견적 공고 [재입찰]",  # 재공고 차수(접미사 있음)
        "10월 가명초, 가명중 급식재료 종합계약 소액수의 견적 공고",  # 최초 공고(접미사 없음)
    )

    script._pseudonymize_bid_history(root)

    rows = script._rows(script._dataset(root, "ds_bidHistory"))
    rebid_row_bid_nm = rows[0].find(f"{{{NS}}}Col").text
    original_row_bid_nm = rows[1].find(f"{{{NS}}}Col").text

    assert rebid_row_bid_nm == script.BID_NM_REBID_PLACEHOLDER
    assert original_row_bid_nm == script.BID_NM_PLACEHOLDER
    assert rebid_row_bid_nm != original_row_bid_nm  # 두 행이 서로 다른 원본 신호를 유지한다
