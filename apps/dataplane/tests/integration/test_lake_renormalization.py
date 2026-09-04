"""로컬 원본 레이크가 있을 때만 도는 eat-v2 재정규화 대조.

남산초 92회차 조사(`namsan_rounds.json`)는 화면 설계가 쓴 실측이며 여기서는 낙찰률과 명단 수라는
집계값으로만 대조한다. 원본 사업자번호·업체명은 단언에 쓰지 않는다.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import ModuleType

import pytest

LAKE = Path(os.environ.get("EATBID_RAW_LAKE", "F:/Project/eat-bid/data/raw/internal"))
ROUNDS = (
    Path(__file__).parents[4]
    / "docs"
    / "product"
    / "decision-screen-v2"
    / "design-generators"
    / "namsan_rounds.json"
)
SCRIPT_PATH = Path(__file__).parents[2] / "scripts" / "renormalize_lake_report.py"

pytestmark = pytest.mark.lake


def _load_script_module() -> ModuleType:
    # 스크립트는 `eatbid` 패키지 밖의 독립 실행 파일이라 경로로 직접 불러온다. 실행할 때와 같은 조건을
    # 만들려면 `lake_report` 하위 모듈을 찾을 수 있게 scripts 디렉터리를 먼저 얹어야 한다.
    if str(SCRIPT_PATH.parent) not in sys.path:
        sys.path.insert(0, str(SCRIPT_PATH.parent))
    spec = importlib.util.spec_from_file_location("renormalize_lake_report", SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


script = _load_script_module()

# 스크립트를 먼저 불러야 scripts 디렉터리가 sys.path에 얹혀 `lake_report`를 찾을 수 있다.
from lake_report.derived import verdict
from lake_report.render import render_markdown


@pytest.fixture(scope="module")
def _lake() -> Path:
    if not LAKE.is_dir():
        pytest.skip("로컬 원본 레이크가 없다")
    return LAKE


@pytest.fixture(scope="module")
def _rounds() -> dict[str, dict[str, object]]:
    return {row["bidId"]: row for row in json.loads(ROUNDS.read_text(encoding="utf-8"))}


def test_남산초_회차의_낙찰률과_명단_수가_조사값과_일치한다(
    _lake: Path, _rounds: dict[str, dict[str, object]]
) -> None:
    observed = script.summarize_rounds(_lake, external_bid_ids=tuple(_rounds))

    assert set(observed) == set(_rounds)
    for bid_id, summary in observed.items():
        expected = _rounds[bid_id]
        assert summary.award_rate == f"{expected['winRate']:.3f}"
        assert summary.roster_size == expected["nBids"]


def test_남산초_회차_전부가_격리되지_않고_정규화된다(
    _lake: Path, _rounds: dict[str, dict[str, object]]
) -> None:
    report = script.build_report(
        _lake, external_bid_ids=tuple(_rounds), calc_version="test"
    )

    assert report.quarantined == 0
    assert report.normalized == len(_rounds)
    # `maxima`는 관측과 계약 상한만 담고 판정은 `derived.verdict`가 낸다(render가 쓰는 함수).
    maximum = report.maxima["bid_rate"]
    assert verdict(maximum["observed"], maximum["contract"]) == "상한 이내"


def test_회차_대조_절이_실제_리포트에_렌더된다(
    _lake: Path, _rounds: dict[str, dict[str, object]]
) -> None:
    report = script.build_report(
        _lake,
        limit=200,
        calc_version="test",
        rounds_source=ROUNDS,
    )

    assert report.rounds is not None
    assert report.rounds.listed == len(_rounds)
    assert report.rounds.matched == len(_rounds)
    assert report.rounds.mismatched == ()
    assert report.rounds.quarantined == ()
    document = render_markdown(report)
    assert "## 회차 조사 대조" in document
    assert "### 하한율별 분해" in document


def test_불변식_위반이_리포트에_수로_남는다(_lake: Path) -> None:
    report = script.build_report(_lake, limit=400, calc_version="test")

    assert report.sample_count == report.normalized + report.quarantined
    assert report.invariants["multiple_award_rows"] == 0
    assert report.invariants["award_below_floor"] == 0
    assert report.invariants["draw_average_mismatch"] == 0
    assert report.invariants["draw_average_checked"] == report.normalized


def test_판정_코드는_낙찰과_낙찰실패_둘뿐이다(_lake: Path) -> None:
    report = script.build_report(_lake, limit=400, calc_version="test")

    assert {code for code, _count in report.bid_status_counts} == {"002", "005"}
    assert dict(report.award_method_fields) == {"SUCBID_DCSN_MTH_CD": report.sample_count}
