"""모듈 책임: `apps/dataplane/scripts/pseudonymize_eat_detail_fixture.py`의 순수 가명화 함수 두 개
(사업자번호 형식 보존, `BID_NM` 접미사 보존)를 단위로 검증한다. 이 스크립트는 `eatbid` 패키지 밖의
독립 실행 파일이라 파일 경로로 직접 불러온다.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

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
    original_with_suffix = "10월 소안초, 소안중 급식재료 종합계약 소액수의 견적 공고 [재입찰]"
    original_without_suffix = "10월 소안초, 소안중 급식재료 종합계약 소액수의 견적 공고"

    assert script.resolve_bid_name(original_with_suffix) == script.BID_NM_REBID_PLACEHOLDER
    assert script.resolve_bid_name(original_without_suffix) == script.BID_NM_PLACEHOLDER
    # 값이 없는 행(Col 요소 자체가 없어 text가 None인 경우)도 접미사 없음으로 처리해 예외 없이 처리한다.
    assert script.resolve_bid_name(None) == script.BID_NM_PLACEHOLDER
