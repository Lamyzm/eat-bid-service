"""열린 공고 스냅샷 빌드가 목록 관측을 다시 읽어 어떤 행을 만드는지 실제 PostgreSQL에서 확인한다."""

from __future__ import annotations

from decimal import Decimal
from pathlib import Path
from uuid import UUID

from eatbid.mart.open_auction_snapshot import (
    LIST_ENDPOINT,
    open_auction_snapshot_filler,
)

from .conftest import PipelineServices
from .mart_seed import code_value
from .mart_support import (
    MART_COMPUTED_AT,
    build_mart,
    create_source_release,
    fetch_all,
    mart_plan,
    open_build,
    verify_and_activate,
)
from .test_normalize_validate import capture_detail, start_run

LIST_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-list-one.xml"
LIST_PARSER_VERSION = "eat-v1"
SNAPSHOT = "open_auction_snapshot"
# fixture 목록 한 행의 관측값이다. 기대값을 손으로 적지 않도록 원본에서 그대로 옮겨 적는다.
LISTED_BID_ID = "5610615"
LISTED_ORGANIZATION_CODE = "199148"


def _seed_list_observation(
    services: PipelineServices, source_release_id: UUID
) -> int:
    run_id = start_run(services, parser_version=LIST_PARSER_VERSION)
    observation_id = capture_detail(
        services,
        run_id=run_id,
        external_bid_id=LISTED_BID_ID,
        body=LIST_FIXTURE.read_bytes(),
        endpoint=LIST_ENDPOINT,
    )
    with services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.source_release_run (source_release_id, run_id) values (%s, %s)",
            (source_release_id, run_id),
        )
        cursor.execute(
            "insert into ingest.source_release_observation "
            "(source_release_id, observation_id) values (%s, %s)",
            (source_release_id, observation_id),
        )
    services.connection.commit()
    return observation_id


def _snapshot_rows(services: PipelineServices, build_id: int) -> list[tuple]:
    return fetch_all(
        services,
        """
        select attempt.external_bid_id, snapshot.bid_count, snapshot.closes_at,
               snapshot.source_last_changed_at, snapshot.base_amount, snapshot.currency,
               snapshot.observation_id, snapshot.organization_id, snapshot.observed_at
          from mart.open_auction_snapshot as snapshot
          join core.auction_attempt as attempt
            on attempt.auction_attempt_id = snapshot.auction_attempt_id
         where snapshot.build_id = %s
         order by attempt.external_bid_id
        """,
        (build_id,),
    )


def _plan(services: PipelineServices, source_release_id: UUID):
    return mart_plan(
        source_release_id,
        mart_name=SNAPSHOT,
        parser_version=LIST_PARSER_VERSION,
    )


def test_목록_관측을_다시_읽어_스냅샷_행과_근거를_남긴다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    observation_id = _seed_list_observation(pipeline_services, source_release_id)
    plan = _plan(pipeline_services, source_release_id)

    build_id, row_count = build_mart(
        pipeline_services, plan, open_auction_snapshot_filler(pipeline_services.store)
    )

    rows = _snapshot_rows(pipeline_services, build_id)
    assert row_count == len(rows) == 1
    (row,) = rows
    assert row[0] == LISTED_BID_ID
    assert row[1] == 0
    # 원본의 마감·변경 시각은 KST 벽시계이고 파서가 UTC instant로 옮긴 뒤 저장된다.
    assert row[2].isoformat() == "2026-09-14T01:00:00+00:00"
    assert row[3].isoformat() == "2026-09-02T08:59:56+00:00"
    assert row[4] == Decimal("69000000.00")
    assert row[5] == "KRW"
    assert row[6] == observation_id


def test_아직_상세를_따지_않은_공고도_identity_전용_attempt로_먼저_만든다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(pipeline_services, source_release_id)
    plan = _plan(pipeline_services, source_release_id)

    build_id, _ = build_mart(
        pipeline_services, plan, open_auction_snapshot_filler(pipeline_services.store)
    )

    assert len(_snapshot_rows(pipeline_services, build_id)) == 1
    # attempt는 만들되 revision은 없다. revision이 없는 attempt는 회차로 발표되지 않는다.
    (counts,) = fetch_all(
        pipeline_services,
        """
        select count(*)
          from core.auction_attempt as attempt
          left join core.auction_revision as revision using (auction_attempt_id)
         where attempt.source_system = 'eat' and attempt.external_bid_id = %s
           and revision.auction_revision_id is null
        """,
        (LISTED_BID_ID,),
    )
    assert counts[0] == 1


def test_조직은_관측된_코드로만_잇고_이름으로_만들지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(pipeline_services, source_release_id)

    first_build, _ = build_mart(
        pipeline_services,
        _plan(pipeline_services, source_release_id),
        open_auction_snapshot_filler(pipeline_services.store),
    )
    # 아직 그 코드의 조직이 core에 없으므로 조직을 지어내지 않고 unknown으로 남긴다.
    assert _snapshot_rows(pipeline_services, first_build)[0][7] is None

    organization_code_value_id = code_value(
        pipeline_services, namespace="eat:organization", code=LISTED_ORGANIZATION_CODE
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.organization (type, canonical_name) "
            "values ('unknown', null) returning organization_id"
        )
        organization = cursor.fetchone()
        assert organization is not None
        cursor.execute(
            "select observation_id from ingest.raw_observation order by observation_id limit 1"
        )
        evidence = cursor.fetchone()
        assert evidence is not None
        cursor.execute(
            "insert into core.organization_identifier "
            "(organization_id, code_value_id, observation_id) values (%s, %s, %s)",
            (organization[0], organization_code_value_id, evidence[0]),
        )
    pipeline_services.connection.commit()

    second_build, _ = build_mart(
        pipeline_services,
        _plan(
            pipeline_services, create_source_release(pipeline_services)
        ),
        open_auction_snapshot_filler(pipeline_services.store),
    )
    del second_build
    third_build, _ = build_mart(
        pipeline_services,
        mart_plan(
            source_release_id,
            mart_name=SNAPSHOT,
            calc_version="mart-r2",
            parser_version=LIST_PARSER_VERSION,
        ),
        open_auction_snapshot_filler(pipeline_services.store),
    )
    assert _snapshot_rows(pipeline_services, third_build)[0][7] == organization[0]


def test_같은_관측을_두_번_읽어도_스냅샷_행_수가_같다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(pipeline_services, source_release_id)
    plan = _plan(pipeline_services, source_release_id)
    build_id = open_build(pipeline_services, plan)
    filler = open_auction_snapshot_filler(pipeline_services.store)

    first = filler(pipeline_services.connection, plan=plan, build_id=build_id)
    second = filler(pipeline_services.connection, plan=plan, build_id=build_id)
    pipeline_services.connection.commit()
    verify_and_activate(pipeline_services, plan, build_id, first)

    assert first == 1
    # 같은 grain을 다시 넣으려 하면 아무 행도 더해지지 않는다.
    assert second == 0
    assert len(_snapshot_rows(pipeline_services, build_id)) == 1


def test_물린_build의_스냅샷_행은_회수_시점_전에는_지워지지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(pipeline_services, source_release_id)
    filler = open_auction_snapshot_filler(pipeline_services.store)

    previous_build, _ = build_mart(
        pipeline_services, _plan(pipeline_services, source_release_id), filler
    )
    next_build, _ = build_mart(
        pipeline_services,
        mart_plan(
            source_release_id,
            mart_name=SNAPSHOT,
            calc_version="mart-r2",
            parser_version=LIST_PARSER_VERSION,
        ),
        filler,
    )

    (state,) = fetch_all(
        pipeline_services,
        "select status, retain_until from mart.build where build_id = %s",
        (previous_build,),
    )
    assert state[0] == "superseded"
    # 참여 수 추이가 지난 관측점을 읽으므로 회수 시점은 전환 시각보다 뒤에 있다.
    assert state[1] > MART_COMPUTED_AT
    assert len(_snapshot_rows(pipeline_services, previous_build)) == 1
    assert len(_snapshot_rows(pipeline_services, next_build)) == 1
