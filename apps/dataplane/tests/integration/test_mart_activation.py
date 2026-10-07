"""mart build의 멱등 개시·검증·원자적 활성화·실패 처리를 실제 PostgreSQL에서 확인한다."""

from __future__ import annotations

from datetime import timedelta

import psycopg
import pytest

from eatbid.mart.build_marts import build_mart, resolve_marts
from eatbid.mart.models import MART_NAMES, MartBuildPlan
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.repository import MartBuildContractError
from eatbid.pipeline.project import project_publication

from .conftest import MigratedDatabase, PipelineServices
from .mart_support import create_source_release, fetch_all, mart_plan
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, publish_v2_observation


def _repository(
    services: PipelineServices,
    migrated_db: MigratedDatabase,
    *,
    builder=fill_org_round_summary,
) -> PsycopgMartBuildRepository:
    return PsycopgMartBuildRepository(
        services.connection,
        migrated_db.connect,
        {"org_round_summary": builder},
    )


def _publish(services: PipelineServices) -> None:
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )


def _active_build(services: PipelineServices) -> int | None:
    rows = fetch_all(
        services,
        "select build_id from mart.build where mart_name = 'org_round_summary' "
        "and status = 'active'",
    )
    return None if not rows else int(rows[0][0])


def test_같은_멱등_키로_두_번_불러도_build가_하나다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    plan = mart_plan(create_source_release(pipeline_services))
    repository = _repository(pipeline_services, migrated_db)

    first = build_mart(plan, repository, failure_category="CONFIGURATION")
    second = build_mart(plan, repository, failure_category="CONFIGURATION")

    assert first.build_id == second.build_id
    assert second.status == "active"
    (count,) = fetch_all(
        pipeline_services,
        "select count(*) from mart.build where source_release_id = %s",
        (plan.source_release_id,),
    )
    assert count[0] == 1


def test_새_build를_활성화하면_이전_활성_build가_물린다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    source_release_id = create_source_release(pipeline_services)
    repository = _repository(pipeline_services, migrated_db)
    previous = build_mart(
        mart_plan(source_release_id, calc_version="mart-r1"),
        repository,
        failure_category="CONFIGURATION",
    )

    latest = build_mart(
        mart_plan(source_release_id, calc_version="mart-r2"),
        repository,
        failure_category="CONFIGURATION",
    )

    assert _active_build(pipeline_services) == latest.build_id
    (state,) = fetch_all(
        pipeline_services,
        "select status, superseded_at, retain_until from mart.build where build_id = %s",
        (previous.build_id,),
    )
    assert state[0] == "superseded"
    assert state[1] is not None
    assert state[2] is not None
    # 회차 요약의 물린 build는 아무도 읽지 않으므로 3시간만 남긴다. 1일이면 30분마다 물리는 사본이 40여 벌
    # 쌓여 55GB가 됐다(2026-10-07, EAT-303).
    assert state[2] - state[1] == timedelta(hours=3)


def test_빌드가_실패하면_활성_포인터가_움직이지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    source_release_id = create_source_release(pipeline_services)
    healthy = _repository(pipeline_services, migrated_db)
    published = build_mart(
        mart_plan(source_release_id, calc_version="mart-r1"),
        healthy,
        failure_category="CONFIGURATION",
    )

    def 무너지는_빌더(connection: object, *, plan: MartBuildPlan, build_id: int) -> int:
        del connection, plan, build_id
        raise RuntimeError("builder collapsed")

    failing = _repository(pipeline_services, migrated_db, builder=무너지는_빌더)
    failing_plan = mart_plan(source_release_id, calc_version="mart-r2")
    with pytest.raises(RuntimeError):
        build_mart(failing_plan, failing, failure_category="DATA_QUARANTINED")

    # 화면은 이전 build를 계속 읽는다. stale은 오류가 아니다.
    assert _active_build(pipeline_services) == published.build_id
    pipeline_services.connection.rollback()
    (failed,) = fetch_all(
        pipeline_services,
        "select status, failure_category from mart.build where calc_version = 'mart-r2' "
        "and source_release_id = %s",
        (source_release_id,),
    )
    assert failed == ("failed", "DATA_QUARANTINED")


def test_활성_build의_행은_DB가_쓰기를_거부한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    plan = mart_plan(create_source_release(pipeline_services))
    result = build_mart(
        plan, _repository(pipeline_services, migrated_db), failure_category="CONFIGURATION"
    )

    with (
        pytest.raises(psycopg.errors.CheckViolation),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            "delete from mart.org_round_summary where build_id = %s", (result.build_id,)
        )
    pipeline_services.connection.rollback()


def test_실패한_build를_다시_열면_행과_함께_새로_시작한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    source_release_id = create_source_release(pipeline_services)
    plan = mart_plan(source_release_id, calc_version="mart-r9")

    def 무너지는_빌더(connection: object, *, plan: MartBuildPlan, build_id: int) -> int:
        del connection, plan, build_id
        raise RuntimeError("builder collapsed")

    with pytest.raises(RuntimeError):
        build_mart(
            plan,
            _repository(pipeline_services, migrated_db, builder=무너지는_빌더),
            failure_category="CONFIGURATION",
        )
    pipeline_services.connection.rollback()

    recovered = build_mart(
        plan, _repository(pipeline_services, migrated_db), failure_category="CONFIGURATION"
    )

    assert recovered.status == "active"
    assert recovered.row_count > 0
    (count,) = fetch_all(
        pipeline_services,
        "select count(*) from mart.build where calc_version = 'mart-r9' "
        "and source_release_id = %s",
        (source_release_id,),
    )
    assert count[0] == 1


def test_채우기_시작과_끝을_workflow_시각이_아니라_DB_시계로_mart마다_남긴다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """왜: `started_at`·`computed_at`·`activated_at`은 workflow가 한 번 찍은 같은 값이라 mart별 계산 시간을 말하지
    못했다(EAT-300). 채우기 트랜잭션 안에서 흐르는 `clock_timestamp()`여야 둘의 차이가 실제 계산 시간이다."""
    _publish(pipeline_services)
    plan = mart_plan(create_source_release(pipeline_services))

    def slow_builder(connection: object, *, plan: MartBuildPlan, build_id: int) -> int:
        with connection.cursor() as cursor:  # type: ignore[attr-defined]
            cursor.execute("select pg_sleep(0.2)")
        return fill_org_round_summary(connection, plan=plan, build_id=build_id)

    result = build_mart(
        plan,
        _repository(pipeline_services, migrated_db, builder=slow_builder),
        failure_category="CONFIGURATION",
    )

    ((started, finished, workflow_started),) = fetch_all(
        pipeline_services,
        "select fill_started_at, fill_finished_at, started_at from mart.build where build_id = %s",
        (result.build_id,),
    )
    assert started is not None and finished is not None
    assert (finished - started).total_seconds() >= 0.2
    # workflow가 넘긴 시각과 다른 시계다. 같다면 여전히 한 값을 세 번 적는 것이다.
    assert started != workflow_started


def test_mart_이름을_모르면_빌드를_시작하기_전에_끊는다() -> None:
    with pytest.raises(MartBuildContractError):
        resolve_marts(requested=["supplier_monthly_record"], run_mode="poll-open")
    assert resolve_marts(requested=None, run_mode="poll-open") == ("open_auction_snapshot",)
    assert set(resolve_marts(requested=None, run_mode="backfill")) < set(MART_NAMES)
