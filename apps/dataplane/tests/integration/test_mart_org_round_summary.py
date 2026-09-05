"""회차 요약 mart 빌드가 실제 PostgreSQL에서 어떤 행을 만드는지 확인한다.

`test_project_v2.py`와 나눈 이유는 검증 대상이 다르기 때문이다. 그쪽은 core에 무엇이 앉는지이고
여기는 그 core에서 화면이 읽는 파생 행이 어떻게 만들어지는지다.

DB는 session 하나를 공유하므로 앞선 test가 발행한 회차가 그대로 남는다. 그래서 단언은 전체 행 수가
아니라 그 test가 만든 attempt로 좁힌다. 전량 재빌드라는 사실 자체는 마지막 test가 확인한다.
"""

from __future__ import annotations

from decimal import Decimal

from eatbid.mart.derivations import (
    awarded_bid_rate,
    day_floor_amount,
    day_floor_bid_rate,
)
from eatbid.mart.org_round_summary import fill_org_round_summary
from eatbid.pipeline.project import project_publication

from .conftest import PipelineServices
from .mart_support import build_mart, create_source_release, fetch_all, mart_plan
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, publish_v2_observation

SUMMARY_COLUMNS = (
    "summary.floor_rate, summary.base_amount, summary.planned_amount, summary.currency, "
    "summary.awarded_assessment_rate, summary.runner_up_assessment_rate, "
    "summary.day_floor_amount, summary.day_floor_bid_rate, summary.awarded_bid_rate, "
    "summary.list_count, summary.below_day_floor_count, summary.withdrawn_count, "
    "summary.withdrawal_cohort_age_days, summary.lineage_status, summary.opened_month_kst, "
    "summary.auction_revision_id, summary.item_code_value_id, summary.item_label"
)


def _publish_and_project(services: PipelineServices) -> str:
    publication_id, external_bid_id = publish_v2_observation(
        services, ROSTER_FIXTURE.read_bytes()
    )
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    return external_bid_id


def _rows_for(services: PipelineServices, build_id: int, external_bid_id: str) -> list[tuple]:
    return fetch_all(
        services,
        f"""
        select {SUMMARY_COLUMNS}
          from mart.org_round_summary as summary
          join core.auction_attempt as attempt
            on attempt.auction_attempt_id = summary.auction_attempt_id
         where summary.build_id = %s and attempt.external_bid_id = %s
        """,
        (build_id, external_bid_id),
    )


def test_회차_요약_빌드가_명단과_낙찰을_한_행으로_요약한다(
    pipeline_services: PipelineServices,
) -> None:
    external_bid_id = _publish_and_project(pipeline_services)
    plan = mart_plan(create_source_release(pipeline_services))

    build_id, _row_count = build_mart(pipeline_services, plan, fill_org_round_summary)

    rows = _rows_for(pipeline_services, build_id, external_bid_id)
    assert len(rows) == 1
    (
        floor_rate,
        base_amount,
        planned_amount,
        currency,
        awarded_assessment,
        _runner_up,
        floor_amount,
        floor_bid_rate,
        awarded_display_rate,
        list_count,
        below_day_floor,
        withdrawn,
        cohort_age_days,
        lineage_status,
        opened_month,
        _revision_id,
        item_code_value_id,
        item_label,
    ) = rows[0]

    assert floor_rate == Decimal("90.000")
    assert base_amount == Decimal("6913400.00")
    assert planned_amount == Decimal("6762461.00")
    assert currency == "KRW"
    assert awarded_assessment == Decimal("90.218")
    assert list_count == 7
    # 명단의 사정률이 모두 하한율 이상이라 하한 미만은 없다. 철회는 원본이 `Y`로 표시한 한 행이다.
    assert below_day_floor == 0
    assert withdrawn == 1
    assert cohort_age_days is not None and cohort_age_days > 0
    assert lineage_status == "observed"
    assert opened_month.isoformat() == "2025-11-01"
    # 품목 code scheme이 없으므로 코드를 지어내지 않고 관측 라벨만 싣는다.
    assert item_code_value_id is None
    assert item_label is None or isinstance(item_label, str)
    # SQL과 사람이 읽는 파생 정의가 갈라지지 않는지 같은 입력으로 맞대어 본다.
    assert floor_amount == day_floor_amount(
        floor_rate=floor_rate, planned_amount=planned_amount
    )
    assert floor_bid_rate == day_floor_bid_rate(
        floor_rate=floor_rate, planned_amount=planned_amount, base_amount=base_amount
    )
    assert awarded_display_rate == awarded_bid_rate(
        assessment_rate=awarded_assessment,
        planned_amount=planned_amount,
        base_amount=base_amount,
    )


def test_그날_하한_금액은_내림하고_레일_비교의_권위를_금액_축에_둔다(
    pipeline_services: PipelineServices,
) -> None:
    external_bid_id = _publish_and_project(pipeline_services)
    plan = mart_plan(create_source_release(pipeline_services))

    build_id, _ = build_mart(pipeline_services, plan, fill_org_round_summary)

    (row,) = _rows_for(pipeline_services, build_id, external_bid_id)
    # 90% × 6,762,461 = 6,086,214.9다. 올림하면 이 금액에 딱 맞춘 투찰이 하한 미만이 된다.
    assert row[6] == Decimal("6086214.90")
    # 같은 사실을 투찰률 축으로 옮기면 조사 자료(`namsan.json` 5669410)의 실효하한 88.035와 같다.
    assert row[7] == Decimal("88.0350")


def test_한_attempt의_최신_revision만_요약한다(
    pipeline_services: PipelineServices,
) -> None:
    external_bid_id = _publish_and_project(pipeline_services)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select revision.auction_attempt_id, revision.observation_id, revision.content_sha256,
                   organization.organization_id
              from core.auction_revision as revision
              join core.auction_attempt as attempt using (auction_attempt_id)
              join core.auction_organization as organization
                on organization.auction_revision_id = revision.auction_revision_id
               and organization.role = 'purchaser'
             where attempt.external_bid_id = %s
            """,
            (external_bid_id,),
        )
        original = cursor.fetchone()
        assert original is not None
        # 같은 attempt에 더 늦은 해석을 하나 더 만든다. 요약은 revision id가 큰 쪽만 읽어야 한다.
        cursor.execute(
            """
            insert into ingest.normalized_record
              (observation_id, record_type, source_entity_id, normalized_payload,
               parser_version, normalized_at)
            values (%s, 'auction.v2', %s, '{}'::jsonb, 'eat-v2-later', now())
            returning normalized_record_id
            """,
            (original[1], external_bid_id),
        )
        later_record = cursor.fetchone()
        assert later_record is not None
        cursor.execute(
            """
            insert into core.auction_revision
              (auction_attempt_id, normalized_record_id, observation_id, content_sha256,
               source_status, title, announced_at, opened_at, base_amount, planned_amount,
               currency, source_payload)
            values (%s, %s, %s, %s, 'OPEN', '나중 해석', now(), now(), 111.00, 100.00,
                    'KRW', '{}'::jsonb)
            returning auction_revision_id
            """,
            (original[0], later_record[0], original[1], original[2]),
        )
        later_revision = cursor.fetchone()
        assert later_revision is not None
        cursor.execute(
            "insert into core.auction_organization "
            "(auction_revision_id, organization_id, role) values (%s, %s, 'purchaser')",
            (later_revision[0], original[3]),
        )
    pipeline_services.connection.commit()

    plan = mart_plan(create_source_release(pipeline_services))
    build_id, _ = build_mart(pipeline_services, plan, fill_org_round_summary)

    rows = _rows_for(pipeline_services, build_id, external_bid_id)
    assert len(rows) == 1
    assert rows[0][15] == later_revision[0]
    assert rows[0][1] == Decimal("111.00")
    # 새 해석에는 `lineage` 블록이 없으므로 사슬은 "없음"이 아니라 "모름"이다.
    assert rows[0][13] == "unknown"


def test_revision이_없는_attempt는_회차로_발표하지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    _publish_and_project(pipeline_services)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.auction_attempt (source_system, external_bid_id) "
            "values ('eat', %s) returning auction_attempt_id",
            (f"chain-only-{id(pipeline_services)}",),
        )
        chain_only = cursor.fetchone()
        assert chain_only is not None
    pipeline_services.connection.commit()

    plan = mart_plan(create_source_release(pipeline_services))
    build_id, row_count = build_mart(pipeline_services, plan, fill_org_round_summary)

    (absent,) = fetch_all(
        pipeline_services,
        "select count(*) from mart.org_round_summary where build_id = %s "
        "and auction_attempt_id = %s",
        (build_id, chain_only[0]),
    )
    assert absent[0] == 0
    # 전량 재빌드이므로 이 build의 행 수는 요약 가능한 회차 전부와 같다.
    (eligible,) = fetch_all(
        pipeline_services,
        """
        select count(distinct revision.auction_attempt_id)
          from core.auction_revision as revision
          join core.auction_organization as organization
            on organization.auction_revision_id = revision.auction_revision_id
           and organization.role = 'purchaser'
         where revision.announced_at is not null and revision.base_amount is not null
        """,
    )
    assert row_count == eligible[0]
