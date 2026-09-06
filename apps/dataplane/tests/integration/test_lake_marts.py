"""로컬 원본 레이크가 있을 때만 도는 남산초 12회차 mart 대조.

`test_lake_projection.py`가 core에 앉은 행을 대조하는 것과 달리 여기는 그 core에서 만든 mart 행을
대조한다. 그래서 파서·projector·mart 빌더 중 어느 쪽이 어긋났는지가 구분된다.

권위는 조사 파일의 **행**이다. 낙찰 사정률·명단 수는 `namsan_rounds.json`이, 그날 하한(투찰률 축)과
금액은 `namsan.json`이 정한다. 하한 미만 수는 `namsan.json`의 `nBids − nValid`가 아니라
`namsan_rounds.json`의 행별 사정률로 센다. 2026-09-06 전수 대조에서 두 값이 두 회차에서 갈라졌다.

- 5708417: `nBids − nValid`는 28이지만 하한 미만 행은 27이다. 90.066에 철회된 행이 하나 있고
  `nValid`가 그것을 유효에서 뺐다. 조사 파일의 행별 status도 `하한미달 27`이다.
- 5744077: 같은 차이가 1이며 철회는 없다. `RNK=2`를 공유하는 90.080 두 행 중 하나를 `nValid`가
  세지 않았다. 행별 status는 `하한미달 14`이다.

즉 `nValid`는 "하한 이상"이 아니라 소스의 다른 규칙이며, 우리 열은 이름대로 하한 미만만 센다.
행별 대조에서는 12/12가 일치한다.

2등 사정률은 조사값과 동치로 두지 않는다. 우리 열은 소스의 `RNK=2` 행이고(설계 §2.1) 조사 파일의
`secondRate`는 명단 전체에서 두 번째로 낮은 사정률이라, 소스가 순위에서 건너뛴 철회 행이 있으면
갈라진다(5708417: 조사값 90.066은 철회 행이고 소스의 `RNK=2`는 90.081이다). 그래서 관측 가능한
불변식만 고정한다.

원본 XML에는 실제 사업자등록번호와 업체명이 들어 있어 저장소에 커밋하지 않는다. 단언에도 집계값만
쓰고 업체 정체성은 읽지 않는다(AGENTS 2·7).
"""

from __future__ import annotations

import gzip
import json
import os
from decimal import Decimal
from pathlib import Path

import pytest

from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .mart_support import build_mart, create_source_release, fetch_all, mart_plan
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import publish_v2_observation

LAKE = Path(os.environ.get("EATBID_RAW_LAKE", "F:/Project/eat-bid/data/raw/internal"))
_GENERATORS = (
    Path(__file__).parents[4] / "docs" / "product" / "decision-screen-v2" / "design-generators"
)
ROUNDS = _GENERATORS / "namsan_rounds.json"
SURVEY = _GENERATORS / "namsan.json"

_ASSESSMENT_QUANTUM = Decimal("0.001")
_DISPLAY_QUANTUM = Decimal("0.0001")

pytestmark = pytest.mark.lake


@pytest.fixture(scope="module")
def _lake() -> Path:
    if not LAKE.is_dir():
        pytest.skip("로컬 원본 레이크가 없다")
    return LAKE


@pytest.fixture(scope="module")
def _rounds() -> list[dict[str, object]]:
    return json.loads(ROUNDS.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def _survey() -> dict[str, dict[str, object]]:
    entries = json.loads(SURVEY.read_text(encoding="utf-8"))
    return {str(entry["bidId"]): entry for entry in entries}


def _locate(lake: Path, external_bid_id: str) -> Path | None:
    """shard 이름 규칙을 가정하지 않고 shard 전체를 훑는다."""
    matches = sorted(lake.glob(f"*/{external_bid_id}.xml.gz"))
    return matches[0] if matches else None


def _summary(services: PipelineServices, build_id: int, external_bid_id: str) -> tuple | None:
    rows = fetch_all(
        services,
        """
        select summary.awarded_assessment_rate, summary.runner_up_assessment_rate,
               summary.list_count, summary.below_day_floor_count,
               summary.day_floor_bid_rate, summary.base_amount, summary.planned_amount,
               summary.floor_rate
          from mart.org_round_summary as summary
          join core.auction_attempt as attempt
            on attempt.auction_attempt_id = summary.auction_attempt_id
         where summary.build_id = %s and attempt.source_system = 'eat'
           and attempt.external_bid_id = %s
        """,
        (build_id, external_bid_id),
    )
    return rows[0] if rows else None


def _survey_rates(round_: dict[str, object]) -> list[Decimal]:
    bids = round_["bids"]
    assert isinstance(bids, list)
    return [Decimal(str(bid["rate"])).quantize(_ASSESSMENT_QUANTUM) for bid in bids]


def _mismatch(external_bid_id: str, label: str, observed: object, expected: object) -> str:
    return f"{external_bid_id} {label}: {observed} != {expected}"


def test_남산초_12회차의_mart_파생값이_조사_자료의_행과_일치한다(
    pipeline_services: PipelineServices,
    _lake: Path,
    _rounds: list[dict[str, object]],
    _survey: dict[str, dict[str, object]],
) -> None:
    missing: list[str] = []
    published: list[str] = []
    for round_ in _rounds:
        external_bid_id = str(round_["bidId"])
        path = _locate(_lake, external_bid_id)
        if path is None:
            missing.append(external_bid_id)
            continue
        publication_id, _ = publish_v2_observation(
            pipeline_services,
            gzip.decompress(path.read_bytes()),
            external_bid_id=external_bid_id,
        )
        project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            repository=pipeline_services.projection_repository,
        )
        published.append(external_bid_id)

    assert missing == []
    plan = mart_plan(create_source_release(pipeline_services))
    build_id, _row_count = build_mart(pipeline_services, plan, fill_org_round_summary)

    mismatches: list[str] = []
    for round_ in _rounds:
        external_bid_id = str(round_["bidId"])
        row = _summary(pipeline_services, build_id, external_bid_id)
        if row is None:
            mismatches.append(f"{external_bid_id}: mart 행이 없다")
            continue
        survey = _survey[external_bid_id]
        (
            awarded,
            runner_up,
            list_count,
            below_floor,
            floor_bid_rate,
            base,
            planned,
            floor_rate,
        ) = row
        survey_rates = _survey_rates(round_)

        expected_floor_rate = Decimal(str(survey["floorRate"])).quantize(_ASSESSMENT_QUANTUM)
        if floor_rate is None or floor_rate.quantize(_ASSESSMENT_QUANTUM) != expected_floor_rate:
            mismatches.append(_mismatch(external_bid_id, "하한율", floor_rate, expected_floor_rate))

        expected_awarded = Decimal(str(round_["winRate"])).quantize(_ASSESSMENT_QUANTUM)
        if awarded is None or awarded.quantize(_ASSESSMENT_QUANTUM) != expected_awarded:
            mismatches.append(_mismatch(external_bid_id, "낙찰 사정률", awarded, expected_awarded))

        expected_rows = len(survey_rates)
        if list_count != expected_rows or expected_rows != int(round_["nBids"]):  # type: ignore[call-overload]
            mismatches.append(_mismatch(external_bid_id, "명단 수", list_count, expected_rows))

        expected_below = sum(1 for rate in survey_rates if rate < expected_floor_rate)
        if below_floor != expected_below:
            mismatches.append(_mismatch(external_bid_id, "하한 미만 수", below_floor, expected_below))

        expected_display_floor = Decimal(str(survey["effFloor"])).quantize(_DISPLAY_QUANTUM)
        if (
            floor_bid_rate is None
            or floor_bid_rate.quantize(_DISPLAY_QUANTUM) != expected_display_floor
        ):
            mismatches.append(
                _mismatch(
                    external_bid_id, "그날 하한(투찰률 축)", floor_bid_rate, expected_display_floor
                )
            )

        # 2등은 소스의 RNK=2 행이다. 조사값과의 동치가 아니라 관측 가능한 불변식만 고정한다.
        if runner_up is None or runner_up.quantize(_ASSESSMENT_QUANTUM) not in survey_rates:
            mismatches.append(_mismatch(external_bid_id, "2등 사정률(명단에 있음)", runner_up, "명단"))
        elif awarded is not None and runner_up < awarded:
            mismatches.append(_mismatch(external_bid_id, "2등 사정률(낙찰 이상)", runner_up, awarded))

        for label, observed, expected in (
            ("기초금액", base, Decimal(str(survey["basePrice"]))),
            ("예정가격", planned, Decimal(str(survey["plannedPrice"]))),
        ):
            if observed is None or observed != expected:
                mismatches.append(_mismatch(external_bid_id, label, observed, expected))

    assert published == [str(round_["bidId"]) for round_ in _rounds]
    # 회차별 불일치를 한 줄씩 보여야 어느 회차의 어느 축이 어긋났는지 바로 읽힌다.
    assert mismatches == [], "\n" + "\n".join(mismatches)
