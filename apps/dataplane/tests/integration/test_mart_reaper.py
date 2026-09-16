"""물린 mart build의 행 회수가 실제 PostgreSQL에서 시한·상태·멱등을 지키는지 확인한다(EAT-254)."""

from __future__ import annotations

from datetime import timedelta

from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.mart.reaper import reap_expired_builds
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

# mart_support.verify_and_activate가 물린 build에 주는 보존 기간이다.
RETENTION = timedelta(days=7)


def _publish(services: PipelineServices) -> None:
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )


def _row_count(services: PipelineServices, build_id: int) -> int:
    ((count,),) = fetch_all(
        services,
        "select count(*) from mart.org_round_summary where build_id = %s",
        (build_id,),
    )
    return int(count)


def _status(services: PipelineServices, build_id: int) -> str:
    ((status,),) = fetch_all(
        services, "select status from mart.build where build_id = %s", (build_id,)
    )
    return str(status)


def test_시한이_지난_물린_build의_행만_지우고_원장_행은_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    _publish(pipeline_services)
    release = create_source_release(pipeline_services)
    previous, previous_rows = build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r1"),
        fill_org_round_summary,
    )
    latest, latest_rows = build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r2"),
        fill_org_round_summary,
    )
    assert previous_rows > 0 and latest_rows > 0

    report = reap_expired_builds(
        pipeline_services.connection,
        as_of=MART_COMPUTED_AT + RETENTION + timedelta(hours=1),
    )

    reaped = {item.build_id: item for item in report.reaped}
    assert previous in reaped and latest not in reaped
    assert reaped[previous].rows_deleted == previous_rows
    assert reaped[previous].mart_name == "org_round_summary"
    assert _row_count(pipeline_services, previous) == 0
    assert _row_count(pipeline_services, latest) == latest_rows
    # 계보는 남는다 — 어떤 입력·규칙으로 화면이 무엇을 보여 줬는지는 행이 없어도 답할 수 있어야 한다.
    assert _status(pipeline_services, previous) == "superseded"
    assert _status(pipeline_services, latest) == "active"


def test_시한_전에는_물린_build도_건드리지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    _publish(pipeline_services)
    release = create_source_release(pipeline_services)
    previous, previous_rows = build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r1"),
        fill_org_round_summary,
    )
    build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r2"),
        fill_org_round_summary,
    )

    report = reap_expired_builds(
        pipeline_services.connection,
        as_of=MART_COMPUTED_AT + RETENTION - timedelta(hours=1),
    )

    assert previous not in {item.build_id for item in report.reaped}
    assert _row_count(pipeline_services, previous) == previous_rows


def test_같은_시각으로_다시_부르면_이미_회수한_build는_보고에_실리지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    _publish(pipeline_services)
    release = create_source_release(pipeline_services)
    previous, _ = build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r1"),
        fill_org_round_summary,
    )
    build_mart(
        pipeline_services,
        mart_plan(release, calc_version="mart-r2"),
        fill_org_round_summary,
    )
    as_of = MART_COMPUTED_AT + RETENTION + timedelta(hours=1)
    first = reap_expired_builds(pipeline_services.connection, as_of=as_of)
    assert previous in {item.build_id for item in first.reaped}

    second = reap_expired_builds(pipeline_services.connection, as_of=as_of)

    assert previous not in {item.build_id for item in second.reaped}
    assert second.to_document()["deleted_rows"] == 0
