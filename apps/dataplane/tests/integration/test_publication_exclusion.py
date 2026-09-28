"""레코드 범위 격리가 원장의 제외로 발행되고, 수량 등식과 fingerprint가 원장과 함께 봉인되는지 실제 PostgreSQL에서
고정한다(ADR 0061, EAT-294)."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from eatbid.core.repository import ProjectionContractError
from eatbid.ingest.postgres_publication_repository import PublicationIntegrityError
from eatbid.ingest.publication_repository import PublicationValidation
from eatbid.pipeline.normalize import DataQuarantinedError
from eatbid.pipeline.project import project_publication, verify_published_publication
from eatbid.pipeline.validate import validate_run

from .conftest import PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    start_run,
)
from .test_project import ACTIVATED_AT
from .test_replay import BROKEN, _capture_pair, _run


def _창을_정규화한다(
    services: PipelineServices, *, broken: int, healthy: int
) -> tuple[UUID, tuple[int, ...]]:
    """기대 `broken + healthy`건 창 하나를 잡아 정규화하고 (run, 깨진 관측들)을 돌려준다."""
    run_id = start_run(services, expected_count=broken + healthy)
    broken_ids: list[int] = []
    for index in range(broken + healthy):
        is_broken = index < broken
        observation_id = capture_detail(
            services,
            run_id=run_id,
            external_bid_id=uuid4().hex,
            body=BROKEN if is_broken else None,
        )
        if is_broken:
            broken_ids.append(observation_id)
            with pytest.raises(DataQuarantinedError):
                normalize_one(services, observation_id)
        else:
            normalize_one(services, observation_id)
    return run_id, tuple(broken_ids)


def _검증한다(services: PipelineServices, run_id: UUID, publication_id: UUID) -> PublicationValidation:
    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    services.connection.commit()
    return result


def _원장(services: PipelineServices, publication_id: UUID) -> list[tuple[object, ...]]:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select observation_id, normalized_record_id, stage, reason_code
            from ingest.publication_exclusion where publication_id = %s
            order by observation_id
            """,
            (publication_id,),
        )
        rows = cursor.fetchall()
    services.connection.commit()
    return rows


def _수량(services: PipelineServices, publication_id: UUID) -> tuple[object, ...]:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select p.status, p.expected_count, p.normalized_count, p.published_count,
                   p.excluded_count, r.status, r.published_count, r.excluded_count
            from ingest.publication p join ingest.run r using (run_id)
            where p.publication_id = %s
            """,
            (publication_id,),
        )
        row = cursor.fetchone()
    services.connection.commit()
    assert row is not None
    return tuple(row)


def test_격리_한_건인_창은_제외_하나와_함께_published로_끝난다(
    pipeline_services: PipelineServices,
) -> None:
    run_id, broken_ids = _창을_정규화한다(pipeline_services, broken=1, healthy=1)
    publication_id = uuid4()

    validated = _검증한다(pipeline_services, run_id, publication_id)

    assert (validated.status, validated.normalized_count, validated.excluded_count) == (
        "validated",
        1,
        1,
    )
    assert _원장(pipeline_services, publication_id) == [
        (broken_ids[0], None, "normalize", "SOURCE_XML_BROKEN")
    ]
    # 재검증은 같은 결과를 돌려주고 원장을 다시 적지 않는다.
    assert _검증한다(pipeline_services, run_id, publication_id) == validated
    assert len(_원장(pipeline_services, publication_id)) == 1

    projected = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert projected.members_projected == 1
    # expected = published + excluded, excluded_count = 원장 행 수.
    assert _수량(pipeline_services, publication_id) == (
        "published", 2, 1, 1, 1, "published", 1, 1,
    )
    evidence = verify_published_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        repository=pipeline_services.projection_repository,
    )
    assert evidence.canonical_fingerprint == projected.canonical_fingerprint
    assert evidence.auction_revision_count == 1


def test_원장_행이_사라지면_공개_재검증이_발행을_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    """원장에 없는 결손은 허용되지 않는다. 수와 원장이 어긋나면 재검증이 계약 위반으로 닫는다(ADR 0061 결정 4)."""
    run_id, _ = _창을_정규화한다(pipeline_services, broken=1, healthy=1)
    publication_id = uuid4()
    _검증한다(pipeline_services, run_id, publication_id)
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "delete from ingest.publication_exclusion where publication_id = %s",
            (publication_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="exclusion ledger"):
        verify_published_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            repository=pipeline_services.projection_repository,
        )


def test_원장의_사유가_바뀌면_봉인된_fingerprint가_어긋난다(
    pipeline_services: PipelineServices,
) -> None:
    run_id, _ = _창을_정규화한다(pipeline_services, broken=1, healthy=1)
    publication_id = uuid4()
    _검증한다(pipeline_services, run_id, publication_id)
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "update ingest.publication_exclusion set reason_code = 'SOURCE_NEXACRO_SHAPE' "
            "where publication_id = %s",
            (publication_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError, match="fingerprint"):
        verify_published_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            repository=pipeline_services.projection_repository,
        )


def test_허용_수를_넘으면_제외_없이_기존처럼_실패한다(
    pipeline_services: PipelineServices,
) -> None:
    """기대 3건이면 허용 수는 1이다. 격리 둘은 레코드 범위라도 우연이 아니라 결함으로 본다."""
    run_id, _ = _창을_정규화한다(pipeline_services, broken=2, healthy=1)
    publication_id = uuid4()

    result = _검증한다(pipeline_services, run_id, publication_id)

    assert (result.status, result.failure_category, result.excluded_count) == (
        "failed",
        "DATA_QUARANTINED",
        0,
    )
    assert _원장(pipeline_services, publication_id) == []
    assert _수량(pipeline_services, publication_id) == (
        "failed", 3, 1, 0, 0, "failed", 0, 0,
    )


def test_열거되지_않은_격리_사유는_상한_안이어도_창_전체를_실패시킨다(
    pipeline_services: PipelineServices,
) -> None:
    """범위 분류의 기본값은 창 전체 실패다. 모르는 사유를 레코드 범위로 추측하지 않는다(ADR 0061 Consequences)."""
    run_id, broken_ids = _창을_정규화한다(pipeline_services, broken=1, healthy=1)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "update ingest.normalization_attempt set quarantine_reason = %s "
            "where run_id = %s and observation_id = %s",
            ("synthetic reason nobody enumerated", run_id, broken_ids[0]),
        )
    pipeline_services.connection.commit()
    publication_id = uuid4()

    result = _검증한다(pipeline_services, run_id, publication_id)

    assert (result.status, result.failure_category) == ("failed", "DATA_QUARANTINED")
    assert _원장(pipeline_services, publication_id) == []


def test_제외가_0이면_수량과_원장이_이전과_같다(
    pipeline_services: PipelineServices,
) -> None:
    run_id, _ = _창을_정규화한다(pipeline_services, broken=0, healthy=2)
    publication_id = uuid4()

    validated = _검증한다(pipeline_services, run_id, publication_id)
    projected = project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=pipeline_services.projection_repository,
    )

    assert validated.excluded_count == 0
    assert _원장(pipeline_services, publication_id) == []
    assert _수량(pipeline_services, publication_id) == (
        "published", 2, 2, 2, 0, "published", 2, 0,
    )
    assert projected.members_projected == 2


def test_이미_격리된_검증_발행의_원장이_비면_재검증이_거부한다(
    pipeline_services: PipelineServices,
) -> None:
    run_id, _ = _창을_정규화한다(pipeline_services, broken=1, healthy=1)
    publication_id = uuid4()
    _검증한다(pipeline_services, run_id, publication_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "delete from ingest.publication_exclusion where publication_id = %s",
            (publication_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="exclusions"):
        validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )


def test_replay도_격리_한_건을_제외로_발행하고_재실행이_멱등이다(
    pipeline_services: PipelineServices,
) -> None:
    """계약을 고친 뒤 창을 되살리는 replay가 한 건 때문에 다시 창 전체를 가리지 않는다(2024-10의 여덟 번 반복)."""
    observation_ids = _capture_pair(pipeline_services, first_body=BROKEN)
    run_id, publication_id = uuid4(), uuid4()

    first = _run(
        pipeline_services, observation_ids, run_id=run_id, publication_id=publication_id
    )
    again = _run(
        pipeline_services, observation_ids, run_id=run_id, publication_id=publication_id
    )

    assert first.status == again.status == "published"
    assert first.canonical_fingerprint == again.canonical_fingerprint
    assert _원장(pipeline_services, publication_id) == [
        (observation_ids[0], None, "normalize", "SOURCE_XML_BROKEN")
    ]
    assert _수량(pipeline_services, publication_id) == (
        "published", 2, 1, 1, 1, "published", 1, 1,
    )
