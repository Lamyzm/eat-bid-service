"""mart 저장소가 트랜잭션을 스스로 열고 닫는지 실제 PostgreSQL 연결로 고정한다(ADR 0059, EAT-289).

왜 통합 시험인가: 판정 대상은 psycopg가 연 암묵 트랜잭션의 존재와 행 잠금이고, 둘 다 실제 연결의
`info.transaction_status`와 서버 잠금으로만 보인다. 가짜 연결로는 운영에서만 깨지는 결함을 못 잡는다.
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import psycopg
import pytest
from psycopg.pq import TransactionStatus

from eatbid.mart.build_marts import build_mart
from eatbid.mart.history_schedule import read_history_schedule
from eatbid.mart.models import MartBuildPlan
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.repository import MartBuildContractError, MartTransactionScopeError

from .conftest import MigratedDatabase, PipelineServices
from .mart_support import create_source_release, fetch_all, mart_plan

# 실패 기록이 잠금에 막히면 영원히 기다리지 말고 이 안에 오류로 끝나게 한다. 막히면 시험이 실패한다.
_LOCK_TIMEOUT = "3s"


def _repository(
    services: PipelineServices,
    migrated_db: MigratedDatabase,
    *,
    builder: Any = fill_org_round_summary,
) -> PsycopgMartBuildRepository:
    def connect_with_lock_timeout() -> psycopg.Connection[Any]:
        connection = migrated_db.connect()
        connection.execute(f"set lock_timeout = '{_LOCK_TIMEOUT}'")
        connection.commit()
        return connection

    return PsycopgMartBuildRepository(
        services.connection, connect_with_lock_timeout, {"org_round_summary": builder}
    )


def _build_state(services: PipelineServices, build_id: int) -> tuple[Any, ...]:
    (row,) = fetch_all(
        services,
        "select status, failure_category from mart.build where build_id = %s",
        (build_id,),
    )
    return tuple(row)


def test_run_mode와_예약_입력을_읽은_뒤_연결에_트랜잭션이_남지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    repository = _repository(pipeline_services, migrated_db)
    connection = pipeline_services.connection

    read_history_schedule(connection)
    assert connection.info.transaction_status is TransactionStatus.IDLE

    assert repository.run_mode(uuid4()) is None
    assert connection.info.transaction_status is TransactionStatus.IDLE


def test_연결에_다른_트랜잭션이_열려_있으면_mart_저장소가_시작하지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """남의 트랜잭션 위에서 블록을 열면 savepoint가 되어 우리 쓰기가 조용히 되감길 수 있다."""
    repository = _repository(pipeline_services, migrated_db)
    plan = mart_plan(create_source_release(pipeline_services))
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select 1")
    assert pipeline_services.connection.info.transaction_status is TransactionStatus.INTRANS

    with pytest.raises(MartTransactionScopeError):
        repository.open_build(plan)
    with pytest.raises(MartTransactionScopeError):
        repository.run_mode(uuid4())
    pipeline_services.connection.rollback()


def test_빌더가_build_행을_잠근_채_무너져도_실패_기록이_막히지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """원 연결이 트랜잭션을 쥔 채 실패를 별도 연결로 적으면 같은 행 잠금을 기다리며 멈춘다."""
    plan = mart_plan(create_source_release(pipeline_services), calc_version="mart-lock")

    def 행을_잠그고_무너지는_빌더(
        connection: Any, *, plan: MartBuildPlan, build_id: int
    ) -> int:
        del plan
        with connection.cursor() as cursor:
            cursor.execute(
                "select 1 from mart.build where build_id = %s for update", (build_id,)
            )
        raise RuntimeError("builder collapsed")

    repository = _repository(
        pipeline_services, migrated_db, builder=행을_잠그고_무너지는_빌더
    )
    with pytest.raises(RuntimeError, match="builder collapsed"):
        build_mart(plan, repository, failure_category="DATA_QUARANTINED")

    assert pipeline_services.connection.info.transaction_status is TransactionStatus.IDLE
    (build,) = fetch_all(
        pipeline_services,
        "select build_id from mart.build where calc_version = 'mart-lock' "
        "and source_release_id = %s",
        (plan.source_release_id,),
    )
    assert _build_state(pipeline_services, int(build[0])) == ("failed", "DATA_QUARANTINED")


def test_검증이_행_수_불일치로_실패하면_연결이_비고_build가_실패로_남는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    plan = mart_plan(create_source_release(pipeline_services), calc_version="mart-count")

    def 수를_부풀리는_빌더(connection: Any, *, plan: MartBuildPlan, build_id: int) -> int:
        return fill_org_round_summary(connection, plan=plan, build_id=build_id) + 1

    repository = _repository(pipeline_services, migrated_db, builder=수를_부풀리는_빌더)
    with pytest.raises(MartBuildContractError, match="row count differs"):
        build_mart(plan, repository, failure_category="CONFIGURATION")

    assert pipeline_services.connection.info.transaction_status is TransactionStatus.IDLE
    (build,) = fetch_all(
        pipeline_services,
        "select build_id from mart.build where calc_version = 'mart-count' "
        "and source_release_id = %s",
        (plan.source_release_id,),
    )
    assert _build_state(pipeline_services, int(build[0])) == ("failed", "CONFIGURATION")


def test_활성화가_실패하면_이전_active를_물린_것까지_되감긴다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    source_release_id = create_source_release(pipeline_services)
    repository = _repository(pipeline_services, migrated_db)
    published = build_mart(
        mart_plan(source_release_id, calc_version="mart-a1"),
        repository,
        failure_category="CONFIGURATION",
    )
    # 검증을 거치지 않은 building build는 활성화 조건(`status = 'verified'`)을 못 넘는다.
    pending_plan = mart_plan(source_release_id, calc_version="mart-a2")
    pending = repository.open_build(pending_plan)

    with pytest.raises(MartBuildContractError, match="not verified"):
        repository.activate_build(pending_plan, pending.build_id)
    assert pipeline_services.connection.info.transaction_status is TransactionStatus.IDLE

    repository.fail_build(pending.build_id, "CONFIGURATION")
    assert _build_state(pipeline_services, published.build_id) == ("active", None)
    assert _build_state(pipeline_services, pending.build_id) == ("failed", "CONFIGURATION")


def test_원_연결에_남은_트랜잭션이_build_행을_잠가도_실패_기록이_먼저_되감고_적는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """저장소 밖 호출자가 트랜잭션을 남긴 채 실패로 넘어와도 실패 기록은 끝나야 한다(ADR 0059-2)."""
    repository = _repository(pipeline_services, migrated_db)
    plan = mart_plan(create_source_release(pipeline_services), calc_version="mart-left")
    opened = repository.open_build(plan)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select 1 from mart.build where build_id = %s for update", (opened.build_id,)
        )
    assert pipeline_services.connection.info.transaction_status is TransactionStatus.INTRANS

    repository.fail_build(opened.build_id, "CONFIGURATION")

    assert pipeline_services.connection.info.transaction_status is TransactionStatus.IDLE
    assert _build_state(pipeline_services, opened.build_id) == ("failed", "CONFIGURATION")
