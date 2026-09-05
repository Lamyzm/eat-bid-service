"""로컬 원본 레이크가 있을 때만 도는 eat-v2 발행 대조.

남산초 12회차 조사(`namsan_rounds.json`)는 화면 설계가 실측으로 적은 값이다. 여기서는 그 회차의 원본을
실제로 발행해 `core.bid_submission` 행 수와 `core.award_decision.awarded_rate`가 조사값과 같은지 본다.
`test_lake_renormalization.py`가 정규화 결과를 대조하는 것과 달리 이쪽은 **core에 앉은 행**을 대조하며,
그래서 파서와 projector 중 어느 쪽이 어긋났는지가 구분된다.

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

from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import publish_v2_observation

LAKE = Path(os.environ.get("EATBID_RAW_LAKE", "F:/Project/eat-bid/data/raw/internal"))
ROUNDS = (
    Path(__file__).parents[4]
    / "docs"
    / "product"
    / "decision-screen-v2"
    / "design-generators"
    / "namsan_rounds.json"
)
# 조사 파일의 낙찰률은 JSON 수이고 `core.award_decision.awarded_rate`는 `numeric(15,3)`이다. 셋째
# 자리로 맞춰 exact decimal끼리 견주면 float 비교를 대조에 들이지 않는다.
_RATE_QUANTUM = Decimal("0.001")

pytestmark = pytest.mark.lake


@pytest.fixture(scope="module")
def _lake() -> Path:
    if not LAKE.is_dir():
        pytest.skip("로컬 원본 레이크가 없다")
    return LAKE


@pytest.fixture(scope="module")
def _rounds() -> list[dict[str, object]]:
    return json.loads(ROUNDS.read_text(encoding="utf-8"))


def _locate(lake: Path, external_bid_id: str) -> Path | None:
    """shard 이름 규칙을 가정하지 않고 shard 전체를 훑는다."""
    matches = sorted(lake.glob(f"*/{external_bid_id}.xml.gz"))
    return matches[0] if matches else None


def _projected(
    services: PipelineServices, external_bid_id: str
) -> tuple[int, Decimal | None]:
    # 읽기도 transaction 블록 안에서 끝낸다. 열린 채로 두면 다음 회차의 발행이 "idle transaction이
    # 아니다"로 끊기고, 그것은 대조 실패가 아니라 이 테스트의 잘못이다.
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            """
            select
              (select count(*) from core.bid_submission s
                where s.auction_attempt_id = a.auction_attempt_id),
              (select d.awarded_rate from core.award_decision d
                where d.auction_attempt_id = a.auction_attempt_id)
            from core.auction_attempt a
            where a.source_system = 'eat' and a.external_bid_id = %s
            """,
            (external_bid_id,),
        )
        row = cursor.fetchone()
    assert row is not None, f"발행된 공고를 찾지 못했다: {external_bid_id}"
    return int(row[0]), row[1]


def test_남산초_12회차의_명단_행_수와_낙찰률이_조사값과_일치한다(
    pipeline_services: PipelineServices,
    _lake: Path,
    _rounds: list[dict[str, object]],
) -> None:
    mismatches: list[str] = []
    missing: list[str] = []
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
        rows, awarded_rate = _projected(pipeline_services, external_bid_id)
        expected_rows = int(round_["nBids"])  # type: ignore[call-overload]
        expected_rate = Decimal(str(round_["winRate"])).quantize(_RATE_QUANTUM)
        observed_rate = (
            awarded_rate.quantize(_RATE_QUANTUM) if awarded_rate is not None else None
        )
        if rows != expected_rows or observed_rate != expected_rate:
            mismatches.append(
                f"{external_bid_id}: 명단 {rows}/{expected_rows} "
                f"낙찰률 {observed_rate}/{expected_rate}"
            )

    assert missing == []
    assert mismatches == []
