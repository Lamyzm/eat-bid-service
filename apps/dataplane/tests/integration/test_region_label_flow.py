"""eat-v3가 관측한 참가제한지역 라벨이 `core.code_label_observation`을 거쳐 행안부 매핑 행이 되는지
실제 PostgreSQL에서 확인한다.

`test_region_mapping_projection.py`는 라벨을 손으로 앉히고 매핑 규칙만 본다. 여기는 라벨이 수집 계약
→ 정규화 → 발행 → 투영을 실제로 통과해 그 표에 닿는지, 그리고 라벨 이전 eat-v2 발행물이 새 모델
아래에서도 그대로 검증되는지를 본다(EAT-75, ADR 0037).
"""

from __future__ import annotations

from pathlib import Path
from uuid import UUID, uuid4

from eatbid.core.region_mapping_projection import project_region_mappings
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.pipeline.project import project_publication, verify_published_publication
from eatbid.pipeline.reference import (
    ReferenceCapturePlan,
    ReferenceServices,
    capture_reference,
    project_reference,
)
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.pipeline.validate import validate_run
from eatbid.source.eat.code_schemes import ELIGIBILITY_AREA
from eatbid.source.reference.source_contracts import (
    LEGAL_DONG_DATASET,
    MOIS_STANDARD_CODE,
)

from ..unit.fakes import MemoryRawObjectStore
from .conftest import PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    NORMALIZED_AT,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    start_run,
)
from .test_project import ACTIVATED_AT
from .test_reference_pipeline import CAPTURED_AT
from .test_region_mapping_projection import (
    LEGAL_DONG_SAMPLE,
    _archive,
    _StaticReferenceClient,
)
from .test_replay import REPLAY_STARTED_AT

ROSTER_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-roster.xml"
# fixture가 실제로 싣는 `PDLC_NM`은 `경남/창원시`인데 행안부 sample release에는 창원시가 없다. 라벨과
# 코드를 sample이 아는 종로구로 바꿔 "관측 라벨 → 행안부 code_value"의 끝까지를 실제로 밟는다. 같은
# 세션 DB를 쓰는 다른 테스트가 체계 전체의 라벨·매핑·code_release 수를 세므로, 행안부 투영과 매핑은
# 되돌리는 transaction 안에서만 살고 발행이 남긴 라벨 행은 끝에 지운다. source release 봉인은 idle
# 연결을 요구해 되돌릴 수 없지만 어느 테스트도 그 수를 세지 않는다.
FIXTURE_AREA_CODE = "15714"
FIXTURE_AREA_LABEL = "경남/창원시"
LABELLED_CODE = "01023"
LABELLED_NAME = "서울/종로구"
MOIS_JONGNO = "1111000000"


def _publish(
    services: PipelineServices, body: bytes, *, parser_version: str, external_bid_id: str
) -> tuple[int, UUID]:
    run_id = start_run(services, parser_version=parser_version)
    observation_id = capture_detail(
        services, run_id=run_id, external_bid_id=external_bid_id, body=body
    )
    normalized = normalize_one(services, observation_id, parser_version=parser_version)
    assert normalized.record_type == "auction.v2"
    publication_id = uuid4()
    validation = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    assert validation.status == "validated"
    project_publication(
        publication_id=publication_id,
        projector_version=BUILD_SHA,
        activated_at=ACTIVATED_AT,
        repository=services.projection_repository,
    )
    return observation_id, publication_id


def _observed_labels(services: PipelineServices, code: str) -> list[tuple[str, int]]:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select o.label, o.observation_id
            from core.code_label_observation o
            join core.code_value v using (code_value_id)
            join core.code_scheme s using (code_scheme_id)
            where s.namespace = %s and v.code = %s
            order by o.code_label_observation_id
            """,
            (ELIGIBILITY_AREA.namespace, code),
        )
        rows = [(str(row[0]), int(row[1])) for row in cursor.fetchall()]
    # 읽기만 했어도 암묵 transaction이 열린다. replay 시작은 idle 연결을 요구하므로 여기서 닫는다.
    services.connection.rollback()
    return rows


def _relabelled_body(code: str, label: str) -> bytes:
    body = ROSTER_FIXTURE.read_text(encoding="utf-8")
    assert body.count(f'<Col id="PDLC_NM">{FIXTURE_AREA_LABEL}</Col>') == 1
    assert body.count(f'<Col id="PDLC_CD">{FIXTURE_AREA_CODE}</Col>') == 1
    return (
        body.replace(f'<Col id="PDLC_NM">{FIXTURE_AREA_LABEL}</Col>', f'<Col id="PDLC_NM">{label}</Col>')
        .replace(f'<Col id="PDLC_CD">{FIXTURE_AREA_CODE}</Col>', f'<Col id="PDLC_CD">{code}</Col>')
        .encode("utf-8")
    )


def _forget_labelled_code(services: PipelineServices, code: str, observation_ids: tuple[int, ...]) -> None:
    """이 테스트가 남긴 라벨·매핑 행만 지운다. 코드 자체와 봉인된 release는 남는다."""
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            """
            delete from core.code_mapping m
            using core.code_value v, core.code_scheme s
            where m.from_code_value_id = v.code_value_id and v.code_scheme_id = s.code_scheme_id
              and s.namespace = %s and v.code = %s
              and m.evidence_observation_id = any(%s)
            """,
            (ELIGIBILITY_AREA.namespace, code, list(observation_ids)),
        )
        cursor.execute(
            """
            delete from core.code_label_observation o
            using core.code_value v, core.code_scheme s
            where o.code_value_id = v.code_value_id and v.code_scheme_id = s.code_scheme_id
              and s.namespace = %s and v.code = %s
              and o.observation_id = any(%s)
            """,
            (ELIGIBILITY_AREA.namespace, code, list(observation_ids)),
        )


def _seal_mois_release(services: PipelineServices) -> tuple[ReferenceCapturePlan, ReferenceServices, int]:
    """정부 파일 관측을 봉인만 한다. core 투영은 호출자의 transaction 안에서 한다."""
    reference = ReferenceServices(
        http_client=_StaticReferenceClient(_archive(LEGAL_DONG_SAMPLE.read_bytes())),
        store=MemoryRawObjectStore(lambda: CAPTURED_AT),
        ingest_repository=services.repository,
        release_repository=PsycopgSourceReleaseRepository(services.connection),
    )
    plan = ReferenceCapturePlan(
        run_id=uuid4(),
        source_release_id=uuid4(),
        source_id=MOIS_STANDARD_CODE,
        dataset=LEGAL_DONG_DATASET,
        release_name=f"legal-dong label-flow {uuid4()}",
        build_sha=BUILD_SHA,
        parser_version="mois-v1",
        as_of=CAPTURED_AT,
        started_at=CAPTURED_AT,
    )
    captured = capture_reference(plan, reference)
    return plan, reference, captured.observation_id


def test_eat_v3_발행은_참가제한지역_라벨을_관측으로_남기고_행안부_매핑이_그_라벨로_행을_만든다(
    pipeline_services: PipelineServices,
) -> None:
    observation_id, _publication_id = _publish(
        pipeline_services,
        _relabelled_body(LABELLED_CODE, LABELLED_NAME),
        parser_version="eat-v3",
        external_bid_id=f"label-{uuid4().hex}",
    )
    mois_observation_id: int | None = None
    try:
        # 라벨은 이 관측을 근거로 남는다. 정규화가 다듬지 않았으므로 소스가 부른 이름 그대로다.
        assert _observed_labels(pipeline_services, LABELLED_CODE) == [
            (LABELLED_NAME, observation_id)
        ]

        plan, reference, mois_observation_id = _seal_mois_release(pipeline_services)
        with pipeline_services.connection.transaction(force_rollback=True):
            cursor = pipeline_services.connection.cursor()
            projected = project_reference(
                cursor,
                store=reference.store,
                source_id=plan.source_id,
                dataset=plan.dataset,
                source_release_id=plan.source_release_id,
                observation_id=mois_observation_id,
                source_version=plan.release_name,
                projected_at=CAPTURED_AT,
            )
            result = project_region_mappings(
                cursor,
                from_scheme=ELIGIBILITY_AREA.namespace,
                code_release_id=projected.code_release_id,
                observation_id=mois_observation_id,
                valid_from=CAPTURED_AT,
            )
            cursor.execute(
                """
                select target.code, m.relation, m.status, m.evidence_observation_id
                from core.code_mapping m
                join core.code_value source on source.code_value_id = m.from_code_value_id
                join core.code_scheme s on s.code_scheme_id = source.code_scheme_id
                join core.code_value target on target.code_value_id = m.to_code_value_id
                where s.namespace = %s and source.code = %s
                """,
                (ELIGIBILITY_AREA.namespace, LABELLED_CODE),
            )
            rows = cursor.fetchall()
            cursor.close()

        assert result.mapped_count >= 1
        # 시도 토막 `서울`은 승인된 별칭 표로 `서울특별시`에 닿고, `종로구`는 그 안에서 유일하게 일치한다.
        assert [(row[0], row[1], row[2], int(row[3])) for row in rows] == [
            (MOIS_JONGNO, "exact", "label_verified", mois_observation_id)
        ]
    finally:
        _forget_labelled_code(
            pipeline_services,
            LABELLED_CODE,
            tuple(item for item in (observation_id, mois_observation_id) if item is not None),
        )


def test_라벨_이전_eat_v2_발행물은_그대로_검증되고_eat_v3_replay가_같은_관측에서_라벨을_채운다(
    pipeline_services: PipelineServices,
) -> None:
    """이미 발행된 revision의 라벨 소급은 replay 한 번이다. 원래 발행물은 바이트도 검증도 흔들리지 않는다."""
    external_bid_id = f"replay-label-{uuid4().hex}"
    code = f"9{uuid4().int % 10_000:04d}"
    # sample release가 모르는 이름이라 다른 매핑 테스트의 release에서는 미매핑으로만 남는다.
    label = "경남/사천시"
    observation_id, v2_publication_id = _publish(
        pipeline_services,
        _relabelled_body(code, label),
        parser_version="eat-v2",
        external_bid_id=external_bid_id,
    )
    assert _observed_labels(pipeline_services, code) == []

    replayed = replay_observations(
        run_id=uuid4(),
        publication_id=uuid4(),
        observation_ids=(observation_id,),
        build_sha=BUILD_SHA,
        parser_version="eat-v3",
        started_at=REPLAY_STARTED_AT,
        normalized_at=NORMALIZED_AT,
        validated_at=VALIDATED_AT,
        activated_at=ACTIVATED_AT,
        services=ReplayServices(
            replay_repository=pipeline_services.replay_repository,
            normalization_repository=pipeline_services.normalization_repository,
            publication_repository=pipeline_services.publication_repository,
            projection_repository=pipeline_services.projection_repository,
            store=pipeline_services.store,
        ),
    )

    assert replayed.status == "published"
    assert _observed_labels(pipeline_services, code) == [(label, observation_id)]
    # 원래 eat-v2 발행물은 새 모델로 되읽어도 canonical이며 지문이 같다(ADR 0037의 exclude_unset 규칙).
    evidence = verify_published_publication(
        publication_id=v2_publication_id,
        projector_version=BUILD_SHA,
        repository=pipeline_services.projection_repository,
    )
    assert evidence.publication_id == v2_publication_id
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select r.source_payload -> 'location' ? 'eligibilityAreas'
            from core.auction_revision r
            join core.auction_attempt a using (auction_attempt_id)
            where a.external_bid_id = %s
            order by r.auction_revision_id
            """,
            (external_bid_id,),
        )
        assert [row[0] for row in cursor.fetchall()] == [False, True]
    pipeline_services.connection.rollback()
