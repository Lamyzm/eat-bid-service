"""모듈 책임: 정부 공개 코드 파일 한 벌을 raw 보존 → release 봉인 → core 투영 순서로 실행한다.

eaT 수집 DAG와 나눈 이유는 발견·fan-out·발행 corpus가 없기 때문이다. 파일 하나가 곧 관측 하나이고
release 하나이며, 그래서 단계도 capture와 project 둘뿐이다. 같은 이미지·같은 run 정체성·같은 실패
분류를 쓰므로 별도 스케줄러를 만들지 않는다(AGENTS 9, ADR 0035).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from eatbid.core.code_release_projection import (
    CodeReleaseProjectionResult,
    project_code_release,
)
from eatbid.core.repository import ProjectionContractError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.release_models import (
    ReleaseDatasetPlan,
    ReleaseDatasetProgress,
    SourceReleasePlan,
)
from eatbid.object_store import MEDIA_TEXT
from eatbid.source.client import SourceResponse
from eatbid.source.reference.mois_client import fetch_reference_payload
from eatbid.source.reference.mois_parser import parse_legal_dong_release
from eatbid.source.reference.source_contracts import (
    decode_reference_payload,
    reference_dataset_contract,
    reference_source_contract,
)

REFERENCE_RECORD_TYPE = "code-release"


@dataclass(frozen=True, slots=True)
class ReferenceCapturePlan:
    run_id: UUID
    source_release_id: UUID
    source_id: str
    dataset: str
    release_name: str
    build_sha: str
    parser_version: str
    as_of: datetime
    started_at: datetime


@dataclass(frozen=True, slots=True)
class ReferenceCaptureResult:
    observation_id: int
    content_sha256: str
    source_release_id: UUID
    member_count: int


@dataclass(frozen=True, slots=True)
class ReferenceServices:
    http_client: Any
    store: Any
    ingest_repository: Any
    release_repository: Any


def capture_reference(
    plan: ReferenceCapturePlan, services: ReferenceServices
) -> ReferenceCaptureResult:
    """파일을 받아 R2에 보존한 뒤 그 관측 하나로 release를 봉인한다.

    계약 검사를 봉인 **전에** 하는 이유는, 컬럼이 바뀐 파일로 봉인해 버리면 그 release가 활성 코드
    한 벌로 남고 다음 실행이 같은 sha로 막혀 되돌릴 자리가 없어지기 때문이다.
    """
    contract = reference_dataset_contract(plan.source_id, plan.dataset)
    payload = fetch_reference_payload(services.http_client, contract=contract)
    rows = decode_reference_payload(payload.body, contract=contract)
    release = parse_legal_dong_release(
        rows,
        contract=contract,
        source_id=plan.source_id,
        source_version=plan.release_name,
    )

    services.ingest_repository.start_run(
        run_id=plan.run_id,
        mode="reference",
        build_sha=plan.build_sha,
        parser_version=plan.parser_version,
        started_at=plan.started_at,
        expected_count=1,
    )
    unit = services.ingest_repository.plan_request_unit(
        run_id=plan.run_id,
        source=plan.source_id,
        endpoint=plan.dataset,
        params={"dataset": plan.dataset},
        expected_count=1,
    )
    services.release_repository.plan_release(
        SourceReleasePlan(
            source_release_id=plan.source_release_id,
            source=plan.source_id,
            release_name=plan.release_name,
            as_of=plan.as_of,
            datasets=(
                ReleaseDatasetPlan(
                    endpoint=plan.dataset,
                    dataset=plan.dataset,
                    record_type=REFERENCE_RECORD_TYPE,
                    parser_version=plan.parser_version,
                    schema_fingerprint=reference_source_contract(
                        plan.source_id
                    ).schema_fingerprint,
                    expected_count=1,
                    observed_count=0,
                    normalized_count=0,
                    quarantined_count=0,
                    required=True,
                ),
            ),
        )
    )
    services.release_repository.attach_run(plan.source_release_id, plan.run_id)

    stored = services.store.put(
        source=plan.source_id,
        endpoint=plan.dataset,
        body=payload.body,
        media=MEDIA_TEXT,
    )
    observation = services.ingest_repository.record_observation(
        request=CaptureRequest(
            request_unit_id=unit.request_unit_id,
            run_id=plan.run_id,
            source=plan.source_id,
            endpoint=plan.dataset,
            params=unit.params,
        ),
        response=SourceResponse(
            status_code=200, body=payload.body, fetched_at=plan.started_at
        ),
        stored=stored,
        failure_category=None,
    )
    services.release_repository.attach_observation(
        plan.source_release_id, observation.observation_id
    )
    services.release_repository.record_dataset_progress(
        plan.source_release_id,
        ReleaseDatasetProgress(
            dataset=plan.dataset,
            observed_count=1,
            normalized_count=1,
            quarantined_count=0,
        ),
    )
    # `reconcile_and_seal`을 쓰지 않는 이유: 그 경로는 eaT 상세 corpus(`ds_info`와 발견 건수 대조)를
    # 전제한다. 정부 파일에는 발견 단계가 없고 관측 하나가 곧 release이므로 dataset 진행을 기록한 뒤
    # 바로 봉인한다. 완결성 판정 자체는 같은 DB trigger가 그대로 강제한다.
    services.release_repository.seal_release(
        plan.source_release_id, sealed_at=plan.started_at
    )
    return ReferenceCaptureResult(
        observation_id=observation.observation_id,
        content_sha256=payload.content_sha256,
        source_release_id=plan.source_release_id,
        member_count=len(release.members),
    )


def project_reference(
    cursor: Any,
    *,
    store: Any,
    source_id: str,
    dataset: str,
    source_release_id: UUID,
    observation_id: int,
    source_version: str,
    projected_at: datetime,
) -> CodeReleaseProjectionResult:
    """봉인된 관측을 R2에서 다시 읽어 core에 앉힌다.

    capture가 들고 있던 파싱 결과를 넘겨받지 않고 다시 읽는 이유는, 투영이 언제나 **보존된 원본**을
    입력으로 삼아야 재실행과 replay가 같은 결과를 내기 때문이다(AGENTS 3).
    """
    contract = reference_dataset_contract(source_id, dataset)
    object_key, observed_at = _observation_object(cursor, observation_id)
    rows = decode_reference_payload(store.read(object_key), contract=contract)
    release = parse_legal_dong_release(
        rows, contract=contract, source_id=source_id, source_version=source_version
    )
    return project_code_release(
        cursor,
        release,
        source_release_id=source_release_id,
        observation_id=observation_id,
        observed_at=observed_at or projected_at,
    )


def _observation_object(cursor: Any, observation_id: int) -> tuple[str, datetime | None]:
    cursor.execute(
        """
        select b.object_key, o.fetched_at
        from ingest.raw_observation o
        join ingest.raw_blob b using (content_sha256)
        where o.observation_id = %s
        """,
        (observation_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError("reference observation is missing")
    return str(row[0]), row[1]
