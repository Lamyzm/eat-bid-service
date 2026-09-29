"""과거 기록 mart 예약(`build-history-marts`)이 최신 발행을 입력으로 삼고, 새 발행이 없으면 아무것도 만들지 않는지를
실제 PostgreSQL에서 확인한다(EAT-300, ADR 0060).

세션이 DB 하나를 공유하므로 시각을 둘로 나눠 둔다. 발행 시각은 다른 시험의 발행보다 뒤(최신 발행이 이 시험의 것이
되도록)에, mart 활성 시각은 뒤이어 도는 mart 시험의 고정 시계(`MART_AS_OF`)보다 앞에 둔다 — 활성 build를 물리는
시각이 물려지는 build의 활성 시각보다 앞서면 `mart_build_supersession_chronology`가 막는다.
"""

from __future__ import annotations

from argparse import Namespace
from datetime import datetime, timedelta
from uuid import UUID, uuid4

from eatbid.composition import Application
from eatbid.mart.models import DEFAULT_REGION_SCHEME
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.postgres_repository import PsycopgMartBuildRepository
from eatbid.mart.win_rate_distribution import fill_win_rate_distribution
from eatbid.pipeline.project import project_publication

from .conftest import MigratedDatabase, PipelineServices
from .mart_support import MART_AS_OF, create_source_release, fetch_all
from .test_normalize_validate import BUILD_SHA
from .test_project_v2 import ROSTER_FIXTURE, publish_v2_observation

PUBLISHED_AT = datetime.fromisoformat("2027-01-01T00:00:00+00:00")


def _publish_latest(services: PipelineServices, *, order: int) -> tuple[UUID, UUID]:
    """발행 하나를 수집 run처럼 release에 매어 공개하고 (release, 발행)을 돌려준다."""
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    source_release_id = create_source_release(services)
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.source_release_run (source_release_id, run_id)
            select %s, run_id from ingest.publication where publication_id = %s
            """,
            (source_release_id, publication_id),
        )
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=PUBLISHED_AT + timedelta(minutes=order),
        repository=services.projection_repository,
    )
    return source_release_id, publication_id


def _application(
    services: PipelineServices, migrated_db: MigratedDatabase
) -> Application:
    return Application(
        connection=services.connection,
        http_client=None,
        mart_repository=PsycopgMartBuildRepository(
            services.connection,
            migrated_db.connect,
            {
                "org_round_summary": fill_org_round_summary,
                "win_rate_distribution_monthly": fill_win_rate_distribution,
            },
        ),
    )


def _first_built_at(services: PipelineServices) -> datetime:
    """뒤이어 도는 mart 시험보다 앞이되, 먼저 돈 시험이 남긴 활성 build보다는 뒤인 시각이다.

    파일 순서를 바꿔 돌려도(`pytest a.py b.py`) 활성 전환의 시각 순서 제약에 걸리지 않게 한다.
    """
    ((latest,),) = fetch_all(
        services,
        "select max(activated_at) from mart.build "
        "where mart_name in ('org_round_summary', 'win_rate_distribution_monthly')",
    )
    floor = MART_AS_OF - timedelta(hours=3)
    return floor if latest is None or latest < floor else latest + timedelta(minutes=1)


def _args(calc_version: str, *, built_at: datetime) -> Namespace:
    return Namespace(
        calc_version=calc_version,
        build_sha=BUILD_SHA,
        parser_version="eat-v2",
        region_scheme=DEFAULT_REGION_SCHEME,
        as_of=built_at,
        built_at=built_at,
    )


def test_예약은_최신_발행을_반영하고_새_발행이_없으면_아무것도_만들지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    # 계산 규칙 이름을 이 시험 것으로 두어 다른 시험이 남긴 활성 build와 멱등 키가 겹치지 않게 한다.
    calc_version = f"hist-{uuid4().hex[:8]}"
    first_built = _first_built_at(pipeline_services)
    application = _application(pipeline_services, migrated_db)
    release, publication = _publish_latest(pipeline_services, order=1)

    built = application.build_history_marts(_args(calc_version, built_at=first_built))

    assert [result.mart_name for result in built] == [
        "org_round_summary",
        "win_rate_distribution_monthly",
    ]
    assert {result.status for result in built} == {"active"}
    rows = fetch_all(
        pipeline_services,
        "select mart_name, source_release_id, publication_id from mart.build "
        "where calc_version = %s and status = 'active' order by mart_name",
        (calc_version,),
    )
    assert rows == [
        ("org_round_summary", release, publication),
        ("win_rate_distribution_monthly", release, publication),
    ]

    # 새 발행이 없다. 할 일이 없는 것이 정상이며 build 행도 늘지 않는다.
    assert (
        application.build_history_marts(
            _args(calc_version, built_at=first_built + timedelta(minutes=30))
        )
        == ()
    )
    (count,) = fetch_all(
        pipeline_services,
        "select count(*) from mart.build where calc_version = %s",
        (calc_version,),
    )
    assert count[0] == 2

    # 새 발행이 생기면 그 발행을 입력으로 다시 만든다.
    _, newer = _publish_latest(pipeline_services, order=2)
    rebuilt = application.build_history_marts(
        _args(calc_version, built_at=first_built + timedelta(hours=1))
    )

    assert [result.mart_name for result in rebuilt] == [
        "org_round_summary",
        "win_rate_distribution_monthly",
    ]
    active = fetch_all(
        pipeline_services,
        "select distinct publication_id from mart.build "
        "where calc_version = %s and status = 'active'",
        (calc_version,),
    )
    assert active == [(newer,)]
