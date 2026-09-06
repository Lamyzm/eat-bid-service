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
from .mart_seed import (
    code_value,
    seed_evidence,
    seed_organization,
    seed_organization_identity,
    seed_round,
)
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
FIXTURE_BID_ID = "5610615"
LISTED_ORGANIZATION_CODE = "199148"
# 같은 DB를 다른 test 파일이 함께 쓰므로 목록 행의 외부 식별자를 이 파일 전용으로 바꾼다. 그래야
# "아직 상세를 따지 않은 공고"라는 상태를 다른 파일의 상세 발행이 흔들지 못한다.
LISTED_BID_ID = "9610615"
# 상세 조인 test 전용 짝이다. 같은 파일 안에서도 조직 코드까지 갈라 두어야 "조직을 이름으로 만들지
# 않는다"를 확인하는 위 test가 이 test가 심은 조직을 보지 않는다.
ENRICHED_BID_ID = "9610616"
ENRICHED_ORGANIZATION_CODE = "199149"
BARE_BID_ID = "9610617"
BARE_ORGANIZATION_CODE = "199150"


def _list_body(
    bid_id: str = LISTED_BID_ID, organization_code: str = LISTED_ORGANIZATION_CODE
) -> bytes:
    return (
        LIST_FIXTURE.read_bytes()
        .replace(FIXTURE_BID_ID.encode(), bid_id.encode())
        .replace(LISTED_ORGANIZATION_CODE.encode(), organization_code.encode())
    )


def _seed_list_observation(
    services: PipelineServices,
    source_release_id: UUID,
    *,
    bid_id: str = LISTED_BID_ID,
    organization_code: str = LISTED_ORGANIZATION_CODE,
) -> int:
    run_id = start_run(services, parser_version=LIST_PARSER_VERSION)
    observation_id = capture_detail(
        services,
        run_id=run_id,
        external_bid_id=bid_id,
        body=_list_body(bid_id, organization_code),
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


def _terms_rows(services: PipelineServices, build_id: int) -> dict[str, tuple]:
    rows = fetch_all(
        services,
        """
        select attempt.external_bid_id, snapshot.floor_rate, snapshot.item_label,
               snapshot.region_sido_code_value_id, snapshot.region_sigungu_code_value_id,
               snapshot.organization_label, snapshot.terms_revision_id
          from mart.open_auction_snapshot as snapshot
          join core.auction_attempt as attempt
            on attempt.auction_attempt_id = snapshot.auction_attempt_id
         where snapshot.build_id = %s
        """,
        (build_id,),
    )
    return {str(row[0]): row[1:] for row in rows}


def _seed_detail(
    services: PipelineServices,
    *,
    bid_id: str,
    organization_code: str,
    organization_label: str,
    floor_rate: Decimal,
    item_label: str,
) -> tuple[int, int, int]:
    """목록에서 만들어질 attempt에 상세 해석 한 벌을 미리 심고 `(revision, 시도, 시군구)`를 준다."""
    evidence = seed_evidence(services)
    organization_id = seed_organization(services, f"합성 기관 {organization_code}")
    seed_organization_identity(
        services,
        organization_id=organization_id,
        code=organization_code,
        label=organization_label,
        observation_id=evidence.observation_id,
    )
    sido_code_value_id = code_value(
        services, namespace="eat:auction-location-sido", code="11"
    )
    sigungu_code_value_id = code_value(
        services, namespace="eat:auction-location-sigungu", code="11110"
    )
    seed_round(
        services,
        evidence,
        organization_id=organization_id,
        opened_at=None,
        awarded_rate=None,
        floor_rate=floor_rate,
        sido_code_value_id=sido_code_value_id,
        sigungu_code_value_id=sigungu_code_value_id,
        external_bid_id=bid_id,
        item_label=item_label,
    )
    (row,) = fetch_all(
        services,
        """
        select max(revision.auction_revision_id)
          from core.auction_revision as revision
          join core.auction_attempt as attempt
            on attempt.auction_attempt_id = revision.auction_attempt_id
         where attempt.source_system = 'eat' and attempt.external_bid_id = %s
        """,
        (bid_id,),
    )
    return int(row[0]), sido_code_value_id, sigungu_code_value_id


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


def test_상세가_있는_공고만_하한율_품목_지역_기관라벨로_채운다(
    pipeline_services: PipelineServices,
) -> None:
    revision_id, sido, sigungu = _seed_detail(
        pipeline_services,
        bid_id=ENRICHED_BID_ID,
        organization_code=ENRICHED_ORGANIZATION_CODE,
        organization_label="합성 급식기관 관측명",
        floor_rate=Decimal("88.500"),
        item_label="축산",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(
        pipeline_services,
        source_release_id,
        bid_id=ENRICHED_BID_ID,
        organization_code=ENRICHED_ORGANIZATION_CODE,
    )
    _seed_list_observation(
        pipeline_services,
        source_release_id,
        bid_id=BARE_BID_ID,
        organization_code=BARE_ORGANIZATION_CODE,
    )

    build_id, _ = build_mart(
        pipeline_services,
        _plan(pipeline_services, source_release_id),
        open_auction_snapshot_filler(pipeline_services.store),
    )

    rows = _terms_rows(pipeline_services, build_id)
    assert rows[ENRICHED_BID_ID] == (
        Decimal("88.500"),
        "축산",
        sido,
        sigungu,
        "합성 급식기관 관측명",
        revision_id,
    )
    # 아직 상세를 따지 않은 공고는 추측으로 메우지 않고 전부 미확인으로 남는다(AGENTS 3).
    assert rows[BARE_BID_ID] == (None, None, None, None, None, None)


def test_같은_attempt에_해석이_둘이면_나중_revision을_싣는다(
    pipeline_services: PipelineServices,
) -> None:
    bid_id = "9610618"
    organization_code = "199151"
    _seed_detail(
        pipeline_services,
        bid_id=bid_id,
        organization_code=organization_code,
        organization_label="합성 재해석 기관",
        floor_rate=Decimal("87.000"),
        item_label="농산",
    )
    latest_revision_id, _, _ = _seed_detail(
        pipeline_services,
        bid_id=bid_id,
        organization_code=organization_code,
        organization_label="합성 재해석 기관",
        floor_rate=Decimal("89.250"),
        item_label="수산",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(
        pipeline_services,
        source_release_id,
        bid_id=bid_id,
        organization_code=organization_code,
    )

    build_id, _ = build_mart(
        pipeline_services,
        _plan(pipeline_services, source_release_id),
        open_auction_snapshot_filler(pipeline_services.store),
    )

    floor_rate, item_label, _, _, _, terms_revision_id = _terms_rows(
        pipeline_services, build_id
    )[bid_id]
    assert (floor_rate, item_label) == (Decimal("89.250"), "수산")
    assert terms_revision_id == latest_revision_id


def test_같은_build를_다시_채워도_상세_조인_값이_같다(
    pipeline_services: PipelineServices,
) -> None:
    bid_id = "9610619"
    organization_code = "199152"
    _seed_detail(
        pipeline_services,
        bid_id=bid_id,
        organization_code=organization_code,
        organization_label="합성 멱등 기관",
        floor_rate=Decimal("90.125"),
        item_label="김치",
    )
    source_release_id = create_source_release(pipeline_services)
    _seed_list_observation(
        pipeline_services,
        source_release_id,
        bid_id=bid_id,
        organization_code=organization_code,
    )
    plan = _plan(pipeline_services, source_release_id)
    build_id = open_build(pipeline_services, plan)
    filler = open_auction_snapshot_filler(pipeline_services.store)

    first = filler(pipeline_services.connection, plan=plan, build_id=build_id)
    pipeline_services.connection.commit()
    before = _terms_rows(pipeline_services, build_id)
    second = filler(pipeline_services.connection, plan=plan, build_id=build_id)
    pipeline_services.connection.commit()
    verify_and_activate(pipeline_services, plan, build_id, first)

    assert (first, second) == (1, 0)
    assert _terms_rows(pipeline_services, build_id) == before
    assert before[bid_id][0] == Decimal("90.125")
