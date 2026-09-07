"""batch 스트리밍 project가 실제 PostgreSQL에서 batch 경계를 넘어도 한 transaction으로 발행하는지 본다.

`test_project.py`와 나눈 이유는 검증 대상이 다르기 때문이다. 그쪽은 구성원 한둘의 잠금·지문·동시성이고
여기는 구성원 수가 batch 크기를 넘을 때의 원자성과 지문 불변이다.
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

import pytest

from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.core.repository import ProjectionContractError
from eatbid.pipeline.project import project_publication, verify_published_publication
from eatbid.pipeline.validate import validate_run

from .conftest import MigratedDatabase, PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    start_run,
)
from .test_project import ACTIVATED_AT

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
# 기본 batch 500을 두 번 꽉 채우고 세 번째가 짧게 남는 크기다. 운영 실측 16,410건은 testcontainers에서
# 시간이 허용하지 않고, batch 경계가 검사 대상이므로 경계를 두 번 넘고 나머지가 남는 것으로 충분하다.
STREAMED_MEMBER_COUNT = 1_203
STREAMED_BATCH_SIZE = 500


def _validated_publication(services: PipelineServices, count: int) -> UUID:
    token = uuid4().hex[:8]
    run_id = start_run(services, expected_count=count)
    body = FIXTURE.read_bytes()
    for index in range(count):
        observation_id = capture_detail(
            services,
            run_id=run_id,
            external_bid_id=f"stream-{token}-{index:05d}",
            body=body,
        )
        normalize_one(services, observation_id)
    publication_id = uuid4()
    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    assert result.status == "validated"
    assert len(result.member_ids) == count
    services.connection.commit()
    return publication_id


def _repository(
    migrated_db: MigratedDatabase, services: PipelineServices, *, batch_size: int
) -> PsycopgCanonicalProjectionRepository:
    return PsycopgCanonicalProjectionRepository(
        services.connection, migrated_db.connect, batch_size=batch_size
    )


def _core_counts(services: PipelineServices, publication_id: UUID) -> tuple[int, int]:
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(distinct ar.auction_revision_id),
                   count(distinct ar.auction_attempt_id)
            from ingest.publication_record pr
            join core.auction_revision ar using (normalized_record_id)
            where pr.publication_id = %s
            """,
            (publication_id,),
        )
        row = cursor.fetchone()
        assert row is not None
        return int(row[0]), int(row[1])


def test_batch_경계를_넘는_발행이_한_transaction에서_전부_공개되고_지문은_batch_크기에_독립적이다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """왜: 16,410건 발행을 통째로 올리다 노드 OOM으로 죽었다(EAT-94). batch로 흘려도 발행은 여전히
    한 번이고, 봉인 지문은 어떤 batch 크기로 다시 검증해도 같아야 한다."""
    publication_id = _validated_publication(pipeline_services, STREAMED_MEMBER_COUNT)

    result = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=_repository(
            migrated_db, pipeline_services, batch_size=STREAMED_BATCH_SIZE
        ),
    )

    assert result.members_projected == STREAMED_MEMBER_COUNT
    assert result.auction_revisions_inserted == STREAMED_MEMBER_COUNT
    assert result.auction_attempts_inserted == STREAMED_MEMBER_COUNT
    assert _core_counts(pipeline_services, publication_id) == (
        STREAMED_MEMBER_COUNT,
        STREAMED_MEMBER_COUNT,
    )
    with (
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            "select status, published_count, canonical_fingerprint "
            "from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (
            "published",
            STREAMED_MEMBER_COUNT,
            result.canonical_fingerprint,
        )

    # 발행 뒤 검증은 같은 스트림을 다른 batch 크기로 다시 돈다. 지문이 batch 경계에 흔들리면 여기서
    # "published canonical fingerprint differs"로 끊긴다.
    for batch_size in (7, STREAMED_MEMBER_COUNT + 1):
        evidence = verify_published_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            repository=_repository(
                migrated_db, pipeline_services, batch_size=batch_size
            ),
        )
        assert evidence.members_projected == STREAMED_MEMBER_COUNT
        assert evidence.auction_revision_count == STREAMED_MEMBER_COUNT
        assert evidence.canonical_fingerprint == result.canonical_fingerprint

    again = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=_repository(migrated_db, pipeline_services, batch_size=13),
    )
    assert again.canonical_fingerprint == result.canonical_fingerprint
    assert again.auction_revisions_inserted == 0
    assert again.members_projected == STREAMED_MEMBER_COUNT


def test_마지막_batch의_계약_위반은_앞_batch가_쓴_행까지_되돌리고_아무것도_공개하지_않는다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    """왜: batch로 나누면 앞 batch의 write가 먼저 일어난다. 그래도 발행은 한 transaction이라 뒤에서
    실패하면 앞의 행도 남지 않아야 한다(AGENTS 변경 절차 "원자적으로 발행")."""
    count, batch_size = 23, 10
    publication_id = _validated_publication(pipeline_services, count)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.normalized_record
            set normalized_payload = normalized_payload || '{"invented":"x"}'::jsonb
            where normalized_record_id = (
                select max(normalized_record_id) from ingest.publication_record
                where publication_id = %s
            )
            """,
            (publication_id,),
        )
        assert cursor.rowcount == 1
        cursor.execute("select count(*) from core.auction_attempt")
        row = cursor.fetchone()
        assert row is not None
        attempts_before = int(row[0])
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="normalized payload"):
        project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            repository=_repository(
                migrated_db, pipeline_services, batch_size=batch_size
            ),
        )

    assert _core_counts(pipeline_services, publication_id) == (0, 0)
    with (
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute("select count(*) from core.auction_attempt")
        assert cursor.fetchone() == (attempts_before,)
        cursor.execute(
            "select p.status, p.published_count, r.failure_category "
            "from ingest.publication p join ingest.run r using (run_id) "
            "where p.publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", 0, "PROJECTION_CONTRACT")


def test_repository는_양수가_아닌_batch_크기를_거부한다(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    for batch_size in (0, -1, True):
        with pytest.raises(ValueError, match="batch size"):
            _repository(migrated_db, pipeline_services, batch_size=batch_size)
