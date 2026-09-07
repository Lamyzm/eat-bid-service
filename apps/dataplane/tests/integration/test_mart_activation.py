"""mart build의 멱등 개시·검증·원자적 활성화·실패 처리를 실제 PostgreSQL에서 확인한다."""

from __future__ import annotations

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


def test_영향_범위는_발행이_실은_record_type이_고른다() -> None:
    assert resolve_marts(requested=None, record_types=()) == MART_NAMES
    # 열린 공고 스냅샷은 record type이 아니라 release의 목록 관측을 읽으므로 언제나 따라온다.
    assert resolve_marts(requested=None, record_types=("auction.v1",)) == (
        "org_round_summary",
        "open_auction_snapshot",
    )
    assert resolve_marts(requested=None, record_types=("auction.v2",)) == (
        "org_round_summary",
        "win_rate_distribution_monthly",
        "open_auction_snapshot",
    )
    # 이름을 직접 주면 언제나 그것이 이긴다.
    assert resolve_marts(
        requested=["open_auction_snapshot"], record_types=("auction.v2",)
    ) == ("open_auction_snapshot",)
    # 모르는 record type을 조용히 무시하지 않는다. 화면이 옛 build를 계속 읽는 편이 더 나쁘다.
    assert resolve_marts(requested=None, record_types=("auction.v9",)) == MART_NAMES
    with pytest.raises(MartBuildContractError):
        resolve_marts(requested=["supplier_monthly_record"], record_types=())
