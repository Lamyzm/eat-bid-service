"""업체명이 그 이름이 관측된 투찰 행에 앉고, 배포 1 이전 행은 채우기 도구가 같은 규칙으로 채우는지 실제
PostgreSQL에서 확인한다(EAT-310, ADR 0063)."""

from __future__ import annotations

import psycopg
import pytest

from eatbid.core.repository import ProjectionTransactionScopeError
from eatbid.core.supplier_label_backfill import (
    SupplierLabelBackfillProgress,
    backfill_supplier_labels,
)
from eatbid.pipeline.project import project_publication

from .conftest import MigratedDatabase, PipelineServices
from .mart_support import fetch_all
from .test_normalize_validate import BUILD_SHA
from .test_project import ACTIVATED_AT
from .test_project_v2 import ROSTER_FIXTURE, ROSTER_ROWS, publish_v2_observation

# 명단 조회(`auction-roster-query.ts`)가 지금 업체명을 고르는 규칙 그대로다. 채운 값이 이것과 같아야 화면이
# 배포 2에서 열을 읽기 시작해도 바뀌지 않는다. 시험 DB는 세션이 함께 쓰므로 이번 시험의 revision으로 좁힌다.
_ROSTER_QUERY_LABELS = """
select submission.roster_ordinal, submission.supplier_label,
       (select label.label from core.code_label_observation label
         where label.code_value_id = account.account_code_value_id
           and label.observation_id = submission.observation_id
         order by label.code_label_observation_id desc limit 1) as observed
  from core.bid_submission submission
  join core.source_supplier_account account
    on account.source_supplier_account_id = submission.source_supplier_account_id
 where submission.auction_revision_id = %s
 order by submission.roster_ordinal
"""


def _publish(services: PipelineServices) -> int:
    """같은 원본을 새 관측으로 발행하고 그 revision id를 돌려준다."""
    publication_id, _ = publish_v2_observation(services, ROSTER_FIXTURE.read_bytes())
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    ((revision_id,),) = fetch_all(
        services, "select max(auction_revision_id) from core.auction_revision"
    )
    return int(revision_id)


def _labels(services: PipelineServices, revision_id: int) -> list[tuple]:
    return fetch_all(services, _ROSTER_QUERY_LABELS, (revision_id,))


def _blank_rows(services: PipelineServices) -> int:
    ((count,),) = fetch_all(
        services, "select count(*) from core.bid_submission where supplier_label is null"
    )
    return int(count)


def _forget_labels(services: PipelineServices) -> None:
    """배포 1 이전에 앉은 행을 흉내 낸다. 그때는 이 칸이 없었다."""
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute("update core.bid_submission set supplier_label = null")


def test_새_투찰_행에는_같은_관측의_업체명이_들어간다(
    pipeline_services: PipelineServices,
) -> None:
    revision_id = _publish(pipeline_services)

    rows = _labels(pipeline_services, revision_id)

    assert len(rows) == ROSTER_ROWS
    assert all(row[1] is not None for row in rows)
    assert [row[1] for row in rows] == [row[2] for row in rows]
    assert rows[0][1] == "비식별 업체 1"


def test_채우기는_빈_칸을_명단_조회와_같은_이름으로_채우고_다시_돌리면_아무것도_바꾸지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    revision_id = _publish(pipeline_services)
    _forget_labels(pipeline_services)
    blank = _blank_rows(pipeline_services)
    progress: list[SupplierLabelBackfillProgress] = []

    first = backfill_supplier_labels(
        pipeline_services.connection, on_progress=progress.append
    )

    rows = _labels(pipeline_services, revision_id)
    assert len(rows) == ROSTER_ROWS
    assert [row[1] for row in rows] == [row[2] for row in rows]
    assert blank >= ROSTER_ROWS
    assert first.rows_filled == blank
    assert first.rows_without_label == 0
    assert progress[-1].parties_done == first.parties
    assert progress[-1].rows_filled == blank

    second = backfill_supplier_labels(pipeline_services.connection)

    assert second.rows_filled == 0
    assert _labels(pipeline_services, revision_id) == rows


def test_같은_관측에서_한_계정의_이름이_둘이면_마지막_이름_관측을_고른다(
    pipeline_services: PipelineServices,
) -> None:
    """옛 모델은 한 관측에 같은 계정의 이름이 둘이어도 행을 둘 남기고 명단 조회가 마지막 행을 골랐다."""
    revision_id = _publish(pipeline_services)
    with (
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            """
            insert into core.code_label_observation (
                code_value_id, label, language, observed_at, observation_id
            )
            select label.code_value_id, '나중 이름', label.language, label.observed_at,
                   label.observation_id
              from core.bid_submission submission
              join core.source_supplier_account account
                on account.source_supplier_account_id = submission.source_supplier_account_id
              join core.code_label_observation label
                on label.code_value_id = account.account_code_value_id
               and label.observation_id = submission.observation_id
             where submission.auction_revision_id = %s and submission.roster_ordinal = 0
            """,
            (revision_id,),
        )
    _forget_labels(pipeline_services)

    backfill_supplier_labels(pipeline_services.connection)

    rows = _labels(pipeline_services, revision_id)
    assert rows[0][1] == "나중 이름"
    assert [row[1] for row in rows] == [row[2] for row in rows]


def test_묶음마다_커밋하고_연결에_열린_트랜잭션을_남기지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    _publish(pipeline_services)
    _forget_labels(pipeline_services)

    backfill_supplier_labels(pipeline_services.connection, target_rows=1)

    assert (
        pipeline_services.connection.info.transaction_status
        is psycopg.pq.TransactionStatus.IDLE
    )
    # 다른 연결에서도 채워져 보여야 묶음별 커밋이 실제로 일어난 것이다.
    with migrated_db.connect() as other, other.cursor() as cursor:
        cursor.execute(
            "select count(*) from core.bid_submission where supplier_label is null"
        )
        assert cursor.fetchone() == (0,)


def test_남의_트랜잭션_위에서는_채우기를_시작하지_않는다(
    pipeline_services: PipelineServices,
) -> None:
    """블록이 savepoint가 되면 묶음마다 커밋한다는 보장이 거짓이 되므로 시작 전에 멈춘다(ADR 0059)."""
    connection = pipeline_services.connection
    with (
        connection.transaction(),
        pytest.raises(ProjectionTransactionScopeError, match="supplier label backfill"),
    ):
        backfill_supplier_labels(connection)
