from __future__ import annotations

from datetime import UTC, datetime
from uuid import uuid4

from eatbid.errors import SourceUnavailableError
from eatbid.failure_categories import (
    PRE_VALIDATION_FAILURE_CATEGORIES,
    TRANSIENT_NETWORK,
)
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.release_repository import SourceReleaseRepository
from eatbid.object_store import RawObjectStore
from eatbid.pipeline.capture import capture
from eatbid.pipeline.discover import DiscoveryPlan
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import PipelineServices

BUILD_SHA = "e" * 64
STARTED_AT = datetime(2026, 9, 6, 3, 0, 0, tzinfo=UTC)
FAILED_AT = datetime(2026, 9, 6, 3, 5, 0, tzinfo=UTC)


def _계획() -> DiscoveryPlan:
    return DiscoveryPlan(
        source_release_id=uuid4(),
        run_id=uuid4(),
        detail_run_id=uuid4(),
        mode="poll-open",
        release_name=f"eat-{uuid4().hex}",
        as_of=STARTED_AT,
        build_sha=BUILD_SHA,
        parser_version="eat-v2",
        started_at=STARTED_AT,
        completed_at=FAILED_AT,
        start_date="20260906",
        end_date="20260906",
        progress_status_code="1",
        region_code="11",
        page_size=100,
        page_budget=10,
    )


def test_응답없는_일시실패_run은_DB에_TRANSIENT_NETWORK로_남고_replay_적격이다(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    plan = _계획()
    persistence = RawFirstDiscoveryPersistence(
        ingest_repository=services.repository,
        release_repository=_사용하지_않는_release(),
        raw_store=_사용하지_않는_store(),
    )
    persistence.start_run(plan)

    persistence.fail_run(
        plan, SourceUnavailableError("eaT request failed", attempts=3)
    )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, failure_category, ended_at from ingest.run where run_id = %s",
            (plan.run_id,),
        )
        run_row = cursor.fetchone()

    assert run_row == ("failed", TRANSIENT_NETWORK, FAILED_AT)
    # 원인이 우리 해석이 아니라 전송이므로 보존된 raw를 다시 해석하는 replay로 복구한다.
    assert run_row[1] in PRE_VALIDATION_FAILURE_CATEGORIES


def test_재시도로_얻은_응답의_시도_횟수를_request_unit에_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v2",
        started_at=STARTED_AT,
        expected_count=1,
    )
    planned = services.repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint="bid-list",
        params={"page": "attempts"},
        expected_count=1,
    )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select attempt_count from ingest.request_unit where request_unit_id = %s",
            (planned.request_unit_id,),
        )
        계획_직후 = cursor.fetchone()

    capture(
        CaptureRequest(
            request_unit_id=planned.request_unit_id,
            run_id=planned.run_id,
            source=planned.source,
            endpoint=planned.endpoint,
            params=planned.params,
        ),
        services.store,
        services.repository,
        StaticSourceClient(
            SourceResponse(200, b"<Root/>", STARTED_AT, 3),
        ),
    )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select attempt_count, status from ingest.request_unit where request_unit_id = %s",
            (planned.request_unit_id,),
        )
        관측_이후 = cursor.fetchone()

    assert 계획_직후 == (1,)
    assert 관측_이후 == (3, "captured")


def _사용하지_않는_release() -> SourceReleaseRepository:
    """이 시험은 run ledger만 건드리므로 release·raw 경계는 호출되지 않는다."""
    return object()  # type: ignore[return-value]


def _사용하지_않는_store() -> RawObjectStore:
    return object()  # type: ignore[return-value]
