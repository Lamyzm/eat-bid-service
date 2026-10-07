"""revision의 jsonb 경로로 읽던 값 넷이 열로 앉고, 배포 1 이전 revision은 채우기 도구가 같은 식으로 채우는지 실제
PostgreSQL에서 확인한다(EAT-308)."""

from __future__ import annotations

import psycopg
import pytest

from eatbid.core.repository import ProjectionTransactionScopeError
from eatbid.core.revision_column_backfill import (
    RevisionColumnBackfillProgress,
    backfill_revision_columns,
)
from eatbid.pipeline.project import project_publication

from .conftest import MigratedDatabase, PipelineServices
from .mart_support import fetch_all
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT, project, validated_from_values
from .test_project_v2 import ROSTER_FIXTURE, ROSTER_ROWS, publish_v2_observation

# 지금 읽는 쪽이 jsonb에서 꺼내는 식이다. 열이 이것과 같아야 배포 2에서 읽는 자리를 바꿔도 화면이 그대로다.
_COLUMNS_AND_PAYLOAD = """
select roster_submission_count, source_roster_size, source_category_label, lineage_observed,
       case when jsonb_typeof(source_payload #> '{roster,submissions}') = 'array'
            then jsonb_array_length(source_payload #> '{roster,submissions}') end,
       (source_payload #>> '{roster,sourceRosterSize}')::integer,
       source_payload #>> '{classification,sourceCategoryLabel}',
       source_payload ? 'lineage'
  from core.auction_revision
 where auction_revision_id = %s
"""

def _latest_revision(services: PipelineServices) -> int:
    ((revision_id,),) = fetch_all(
        services, "select max(auction_revision_id) from core.auction_revision"
    )
    return int(revision_id)


def _columns_and_payload(services: PipelineServices, revision_id: int) -> tuple:
    (row,) = fetch_all(services, _COLUMNS_AND_PAYLOAD, (revision_id,))
    return row


def _publish_v2(services: PipelineServices) -> int:
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    return _latest_revision(services)


def _forget_columns(services: PipelineServices) -> None:
    """배포 1 이전에 앉은 revision을 흉내 낸다. 그때는 이 열들이 없었다."""
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            "update core.auction_revision set roster_submission_count = null,"
            " source_roster_size = null, source_category_label = null,"
            " lineage_observed = null"
        )


def test_새_v2_revision의_열은_jsonb와_같은_값이다(
    pipeline_services: PipelineServices,
) -> None:
    revision_id = _publish_v2(pipeline_services)

    row = _columns_and_payload(pipeline_services, revision_id)

    assert row[:4] == row[4:]
    assert row[0] == ROSTER_ROWS
    assert row[3] is True


def test_v1_revision은_명단_줄_수가_null이고_사슬은_모름이다(
    pipeline_services: PipelineServices,
) -> None:
    """v1 계약에는 명단·사슬 블록이 없다. 0이나 "사슬 없음"으로 메우면 모르는 것을 아는 척하게 된다."""
    project(
        pipeline_services,
        validated_from_values(pipeline_services, external_bid_id="revision-columns-v1"),
    )
    revision_id = _latest_revision(pipeline_services)

    row = _columns_and_payload(pipeline_services, revision_id)

    assert row[:4] == row[4:]
    assert row[0] is None
    assert row[3] is False


def test_채우기는_빈_revision을_jsonb와_같은_식으로_채우고_다시_돌리면_아무것도_바꾸지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    revision_id = _publish_v2(pipeline_services)
    expected = _columns_and_payload(pipeline_services, revision_id)
    _forget_columns(pipeline_services)
    ((blank,),) = fetch_all(
        pipeline_services,
        "select count(*) from core.auction_revision where lineage_observed is null",
    )
    progress: list[RevisionColumnBackfillProgress] = []

    first = backfill_revision_columns(
        pipeline_services.connection, batch_revisions=1, on_progress=progress.append
    )

    assert _columns_and_payload(pipeline_services, revision_id) == expected
    assert first.rows_filled == blank
    assert first.rows_unfilled == 0
    assert progress[-1].rows_filled == blank

    second = backfill_revision_columns(pipeline_services.connection)

    assert second.rows_filled == 0
    assert _columns_and_payload(pipeline_services, revision_id) == expected


def test_범위마다_커밋하고_연결에_열린_트랜잭션을_남기지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish_v2(pipeline_services)
    _forget_columns(pipeline_services)

    backfill_revision_columns(pipeline_services.connection, batch_revisions=1)

    assert (
        pipeline_services.connection.info.transaction_status
        is psycopg.pq.TransactionStatus.IDLE
    )
    with migrated_db.connect() as other, other.cursor() as cursor:
        cursor.execute(
            "select count(*) from core.auction_revision where lineage_observed is null"
        )
        assert cursor.fetchone() == (0,)


def test_남의_트랜잭션_위에서는_revision_채우기를_시작하지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    connection = pipeline_services.connection
    with (
        connection.transaction(),
        pytest.raises(ProjectionTransactionScopeError, match="revision column backfill"),
    ):
        backfill_revision_columns(connection)
