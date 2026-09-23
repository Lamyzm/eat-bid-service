"""mart 빌드 통합 test가 공유하는 build 수명주기 helper."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from eatbid.mart.models import DEFAULT_REGION_SCHEME, MartBuildPlan, MartName

from .conftest import PipelineServices

MART_AS_OF = datetime(2026, 8, 29, 5, 0, 0, tzinfo=UTC)
MART_STARTED_AT = datetime(2026, 8, 29, 5, 0, 10, tzinfo=UTC)
MART_COMPUTED_AT = datetime(2026, 8, 29, 5, 0, 30, tzinfo=UTC)
MART_BUILDER_VERSION = "e" * 40
MART_PARSER_VERSION = "eat-v2"


def create_source_release(services: PipelineServices) -> UUID:
    source_release_id = uuid4()
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.source_release
              (source_release_id, source, release_name, status, as_of)
            values (%s, %s, %s, 'planned', %s)
            """,
            (
                source_release_id,
                f"eat-{uuid4().hex}",
                f"release-{uuid4().hex}",
                MART_AS_OF,
            ),
        )
    services.connection.commit()
    return source_release_id


def mart_plan(
    source_release_id: UUID,
    *,
    mart_name: MartName = "org_round_summary",
    calc_version: str = "mart-r1",
    publication_id: UUID | None = None,
    as_of: datetime = MART_AS_OF,
    parser_version: str = MART_PARSER_VERSION,
) -> MartBuildPlan:
    return MartBuildPlan(
        mart_name=mart_name,
        source_release_id=source_release_id,
        publication_id=publication_id,
        calc_version=calc_version,
        builder_version=MART_BUILDER_VERSION,
        parser_version=parser_version,
        region_scheme=DEFAULT_REGION_SCHEME,
        as_of=as_of,
        started_at=MART_STARTED_AT,
        computed_at=MART_COMPUTED_AT,
    )


def open_build(services: PipelineServices, plan: MartBuildPlan) -> int:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into mart.build
              (mart_name, source_release_id, publication_id, calc_version, builder_version,
               region_scheme, status, as_of, started_at)
            values (%s, %s, %s, %s, %s, %s, 'building', %s, %s)
            returning build_id
            """,
            (
                plan.mart_name,
                plan.source_release_id,
                plan.publication_id,
                plan.calc_version,
                plan.builder_version,
                plan.region_scheme,
                plan.as_of,
                plan.started_at,
            ),
        )
        row = cursor.fetchone()
    services.connection.commit()
    assert row is not None
    return int(row[0])


def verify_and_activate(
    services: PipelineServices, plan: MartBuildPlan, build_id: int, row_count: int
) -> None:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            update mart.build
               set status = 'verified', computed_at = %s, row_count = %s
             where build_id = %s and status = 'building'
            """,
            (plan.computed_at, row_count, build_id),
        )
        cursor.execute(
            """
            update mart.build
               set status = 'superseded', superseded_at = %s,
                   retain_until = %s + interval '7 days'
             where mart_name = %s and status = 'active'
            """,
            (plan.computed_at, plan.computed_at, plan.mart_name),
        )
        cursor.execute(
            """
            update mart.build
               set status = 'active', activated_at = %s
             where build_id = %s and status = 'verified'
            """,
            (plan.computed_at, build_id),
        )
    services.connection.commit()


def build_mart(
    services: PipelineServices,
    plan: MartBuildPlan,
    filler: Callable[..., int],
) -> tuple[int, int]:
    """새 build를 열어 전량 적재하고 검증 뒤 활성으로 옮긴다."""
    build_id = open_build(services, plan)
    row_count = filler(services.connection, plan=plan, build_id=build_id)
    services.connection.commit()
    verify_and_activate(services, plan, build_id, row_count)
    return build_id, row_count


def fetch_all(
    services: PipelineServices, statement: str, params: Any = None
) -> list[tuple]:
    # 읽기도 transaction 블록 안에서 한다. 블록 없이 커서만 쓰면 psycopg가 연 암묵 transaction이 남고,
    # 뒤이은 투영이 "idle transaction이 필요하다"며 거부한다. 기존 시험은 투영 **뒤에만** 불러서 안 걸렸다가
    # 2026-09-23 투영 앞에서 세어 보는 시험이 처음 밟았다 — 운영 코드에서 EAT-264·273·274로 세 번 고친
    # 같은 결함이다. 바깥 transaction이 있으면 savepoint가 되어 그 안의 자료를 그대로 본다.
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(statement, params)
        return cursor.fetchall()
