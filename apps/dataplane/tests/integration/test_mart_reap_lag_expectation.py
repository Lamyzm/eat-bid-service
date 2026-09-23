"""회수 지연 기대가 행이 남은 물린 build를 잡고, 이전 질의와 같은 답을 내는지 실제 PostgreSQL로 고정한다.

왜 이전 질의를 시험에 남기는가: 새 질의는 속도를 위해 모양을 뒤집었다(build마다 묻는 대신 행이 있는
build를 먼저 뽑는다). 모양이 바뀐 질의는 빨라진 대신 답이 달라질 수 있다. 운영에서는 이전 질의가
766초라 두 답을 나란히 볼 수 없으므로, 작은 자료에서 둘이 같은 답을 내는지를 여기서 단언한다.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.reaper import reap_expired_builds
from eatbid.monitoring.expectations import EXPECTATIONS
from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .mart_support import (
    MART_COMPUTED_AT,
    build_mart,
    create_source_release,
    fetch_all,
    mart_plan,
)
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, publish_v2_observation

RETENTION = timedelta(days=7)

# 2026-09-20까지 쓰던 모양이다. 답은 맞았지만 운영에서 한 회차가 766초였다.
PREVIOUS_SQL = """
    select b.mart_name, count(*) as builds,
           min(b.retain_until) as oldest_retain_until
      from mart.build b
     where b.status = 'superseded'
       and b.retain_until < now() - interval '1 day'
       and (
         exists (select 1 from mart.org_round_summary r where r.build_id = b.build_id)
         or exists (select 1 from mart.win_rate_distribution_monthly r
                     where r.build_id = b.build_id)
         or exists (select 1 from mart.open_auction_snapshot r where r.build_id = b.build_id)
       )
     group by b.mart_name
     order by b.mart_name
"""


def _current_sql() -> str:
    return next(item.sql for item in EXPECTATIONS if item.key == "mart-reap-lag")


def _answer(services: PipelineServices, sql: str) -> list[tuple[str, int]]:
    rows = fetch_all(services, sql)
    return [(str(name), int(builds)) for name, builds, _oldest in rows]


def _superseded_build_past_retention(services: PipelineServices) -> int:
    """물린 build 하나를 만들고 그 시한을 이틀 전으로 당긴다. 행은 그대로 남는다."""
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    release = create_source_release(services)
    previous, previous_rows = build_mart(
        services, mart_plan(release, calc_version="mart-r1"), fill_org_round_summary
    )
    build_mart(
        services, mart_plan(release, calc_version="mart-r2"), fill_org_round_summary
    )
    assert previous_rows > 0
    # 기대는 `now()`를 기준으로 본다. 시한을 이틀 전으로 두면 하루 여유를 넘긴 상태가 된다.
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            "update mart.build set retain_until = now() - interval '2 days' where build_id = %s",
            (previous,),
        )
    return previous


def test_시한을_넘기고_행이_남은_물린_build를_잡는다(
    pipeline_services: PipelineServices,
) -> None:
    _superseded_build_past_retention(pipeline_services)

    assert _answer(pipeline_services, _current_sql()) == [("org_round_summary", 1)]


def test_회수가_지운_뒤에는_울리지_않는다(pipeline_services: PipelineServices) -> None:
    previous = _superseded_build_past_retention(pipeline_services)
    report = reap_expired_builds(
        pipeline_services.connection,
        as_of=datetime.now(MART_COMPUTED_AT.tzinfo) + RETENTION,
    )
    assert previous in {item.build_id for item in report.reaped}

    assert _answer(pipeline_services, _current_sql()) == []


def test_이전_질의와_같은_답을_낸다(pipeline_services: PipelineServices) -> None:
    """모양을 뒤집은 질의가 답까지 바꾸지 않았는지 본다. 행이 남은 경우와 지운 뒤 둘 다 대조한다."""
    previous = _superseded_build_past_retention(pipeline_services)
    assert _answer(pipeline_services, _current_sql()) == _answer(
        pipeline_services, PREVIOUS_SQL
    )

    reap_expired_builds(
        pipeline_services.connection,
        as_of=datetime.now(MART_COMPUTED_AT.tzinfo) + RETENTION,
    )
    assert _answer(pipeline_services, _current_sql()) == _answer(
        pipeline_services, PREVIOUS_SQL
    )
    assert previous  # 시한을 당긴 build가 실제로 있었다는 것을 남긴다.
