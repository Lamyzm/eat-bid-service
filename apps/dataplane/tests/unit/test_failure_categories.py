from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from eatbid.cli import exit_code_for_error
from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.failure_categories import (
    DATA_QUARANTINED,
    PRE_VALIDATION_FAILURE_CATEGORIES,
    PROJECTION_CONTRACT,
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    TRANSIENT_NETWORK,
    failure_category_for_error,
)
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.discover import DiscoveryPlan
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.normalize import DataQuarantinedError

NOW = datetime(2026, 9, 6, 3, 0, 0, tzinfo=UTC)


class _기록_ingest:
    def __init__(self) -> None:
        self.failures: list[tuple[UUID, str, datetime]] = []

    def fail_run(
        self, *, run_id: UUID, failure_category: str, failed_at: datetime
    ) -> None:
        self.failures.append((run_id, failure_category, failed_at))


def _계획() -> DiscoveryPlan:
    return DiscoveryPlan(
        source_release_id=uuid4(),
        run_id=uuid4(),
        detail_run_id=uuid4(),
        mode="poll-open",
        release_name="eat-2026-09-06",
        as_of=NOW,
        build_sha="a" * 64,
        parser_version="eat-v2",
        started_at=NOW,
        completed_at=NOW,
        start_date="20260906",
        end_date="20260906",
        progress_status_code="1",
        region_code="11",
        page_size=100,
        page_budget=10,
    )


def _영속화(ingest: _기록_ingest) -> RawFirstDiscoveryPersistence:
    return RawFirstDiscoveryPersistence(
        ingest_repository=ingest,  # type: ignore[arg-type]
        release_repository=object(),  # type: ignore[arg-type]
        raw_store=object(),  # type: ignore[arg-type]
        baseline_reader=object(),  # type: ignore[arg-type]
    )


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (SourceUnavailableError("no response", attempts=3), TRANSIENT_NETWORK),
        (SourceThrottledError(429), SOURCE_THROTTLED),
        (SourceContractError("broken schema"), SOURCE_CONTRACT),
        (DataQuarantinedError(7, "unknown code"), DATA_QUARANTINED),
        (RuntimeError("missing secret"), "CONFIGURATION"),
    ],
)
def test_예외_종류가_그대로_failure_category가_된다(
    error: Exception, expected: str
) -> None:
    assert failure_category_for_error(error) == expected


def test_exit_code와_failure_category가_같은_판정을_쓴다() -> None:
    error = SourceUnavailableError("no response", attempts=3)

    assert failure_category_for_error(error) == TRANSIENT_NETWORK
    assert exit_code_for_error(error) == 69


def test_응답없는_일시실패로_죽은_discovery_run은_TRANSIENT_NETWORK로_남는다() -> None:
    ingest = _기록_ingest()
    plan = _계획()

    _영속화(ingest).fail_run(
        plan, SourceUnavailableError("eaT request failed", attempts=3)
    )

    assert ingest.failures == [(plan.run_id, TRANSIENT_NETWORK, plan.completed_at)]


def test_차단과_계약위반은_각자의_카테고리로_남는다() -> None:
    ingest = _기록_ingest()
    plan = _계획()
    영속화 = _영속화(ingest)

    영속화.fail_run(plan, SourceThrottledError(429))
    영속화.fail_run(plan, SourceContractError("broken schema"))

    assert [failure[1] for failure in ingest.failures] == [
        SOURCE_THROTTLED,
        SOURCE_CONTRACT,
    ]


def test_TRANSIENT_NETWORK는_replay로_복구하는_검증전_실패에_속한다() -> None:
    assert TRANSIENT_NETWORK in PRE_VALIDATION_FAILURE_CATEGORIES
    assert {SOURCE_CONTRACT, DATA_QUARANTINED} <= PRE_VALIDATION_FAILURE_CATEGORIES
    # 검증을 통과한 뒤 publication을 얼린 실패는 부분 topology를 허용하지 않는다.
    assert PROJECTION_CONTRACT not in PRE_VALIDATION_FAILURE_CATEGORIES
