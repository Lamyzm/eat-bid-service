"""모듈 책임: eaT가 공개하는 코드목록 한 벌을 raw 보존 → release 봉인 → core 어휘 투영 순서로 실행한다.

공고 수집 DAG와 나눈 이유는 발견·fan-out·발행 corpus가 없기 때문이다. 왕복 한 번이 곧 관측 하나이고
release 하나이며, 그래서 단계도 capture와 project 둘뿐이다. 정부 파일 실행(`pipeline/reference.py`)과
나눈 이유는 소스 경계가 다르기 때문이다 — 이쪽은 eaT의 검토된 전송 계약과 semaphore를 쓰고, 그쪽은
정부 사이트의 zip 계약을 쓴다. run 정체성·실패 분류·관측 보존 규칙은 셋이 같다(AGENTS 9).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Any
from uuid import UUID

from eatbid.core.code_vocabulary_projection import (
    CodeVocabularyProjectionResult,
    project_code_vocabulary,
)
from eatbid.core.repository import ProjectionContractError
from eatbid.failures.errors import SourceContractError
from eatbid.generated.code_vocabulary_v1 import EatbidCodeVocabularyV1
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.release_models import (
    ReleaseDatasetPlan,
    ReleaseDatasetProgress,
    SourceReleasePlan,
)
from eatbid.pipeline.capture import capture
from eatbid.source.eat.code_vocabulary import CODE_LIST_DATASET, parse_code_vocabulary
from eatbid.source.eat.payload import build_code_list_params
from eatbid.source.eat.registry import EatEndpointContract, require
from eatbid.source.eat.xml import parse_nexacro

CODE_LIST_ENDPOINT = "code-list"
EAT_SOURCE = "eat"


@dataclass(frozen=True, slots=True)
class CodeVocabularyCapturePlan:
    run_id: UUID
    source_release_id: UUID
    release_name: str
    build_sha: str
    parser_version: str
    as_of: datetime
    started_at: datetime


@dataclass(frozen=True, slots=True)
class CodeVocabularyCaptureResult:
    observation_id: int
    content_sha256: str
    source_release_id: UUID
    entry_count: int
    excluded_row_count: int
    # 투영이 같은 이름으로 release를 읽어야 하므로 수집이 쓴 이름을 결과로 돌려준다. 두 단계가 각자
    # 이름을 지으면 같은 실행에서 다른 release를 가리키게 된다.
    release_name: str


@dataclass(frozen=True, slots=True)
class CodeVocabularyServices:
    http_client: Any
    store: Any
    ingest_repository: Any
    release_repository: Any


def capture_code_vocabulary(
    plan: CodeVocabularyCapturePlan, services: CodeVocabularyServices
) -> CodeVocabularyCaptureResult:
    """코드목록을 한 번 받아 R2에 보존한 뒤 그 관측 하나로 release를 봉인한다.

    계약 검사를 봉인 **전에** 하되 raw 보존 **뒤에** 한다. 순서가 이래야 소스가 모양을 바꾼 응답도
    원본으로 남아 나중에 다시 읽을 수 있고(AGENTS 3), 그 응답으로 만든 release가 활성 어휘로 서지는
    않는다. 봉인되지 않은 release는 core 투영이 받지 않는다.
    """
    contract = require(CODE_LIST_ENDPOINT, parser_version=plan.parser_version)
    params = build_code_list_params()

    services.ingest_repository.start_run(
        run_id=plan.run_id,
        mode="code-vocabulary",
        build_sha=plan.build_sha,
        parser_version=plan.parser_version,
        started_at=plan.started_at,
        expected_count=1,
    )
    unit = services.ingest_repository.plan_request_unit(
        run_id=plan.run_id,
        source=EAT_SOURCE,
        endpoint=CODE_LIST_ENDPOINT,
        params=params,
        expected_count=1,
    )
    services.release_repository.plan_release(
        SourceReleasePlan(
            source_release_id=plan.source_release_id,
            source=EAT_SOURCE,
            release_name=plan.release_name,
            as_of=plan.as_of,
            datasets=(
                ReleaseDatasetPlan(
                    endpoint=CODE_LIST_ENDPOINT,
                    dataset=CODE_LIST_DATASET,
                    record_type=contract.record_type,
                    parser_version=contract.parser_version,
                    schema_fingerprint=contract.schema_fingerprint,
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

    observation = capture(
        CaptureRequest(
            request_unit_id=unit.request_unit_id,
            run_id=plan.run_id,
            source=EAT_SOURCE,
            endpoint=CODE_LIST_ENDPOINT,
            params=unit.params,
        ),
        services.store,
        services.ingest_repository,
        services.http_client,
    )
    services.release_repository.attach_observation(
        plan.source_release_id, observation.observation_id
    )

    vocabulary = read_code_vocabulary(
        services.store,
        object_key=observation.object_key,
        content_sha256=observation.content_sha256,
        contract=contract,
    )
    services.release_repository.record_dataset_progress(
        plan.source_release_id,
        ReleaseDatasetProgress(
            dataset=CODE_LIST_DATASET,
            observed_count=1,
            normalized_count=1,
            quarantined_count=0,
        ),
    )
    # `reconcile_and_seal`을 쓰지 않는 이유: 그 경로는 공고 corpus(발견 건수와 상세 관측의 대조)를
    # 전제한다. 코드목록에는 발견 단계가 없고 관측 하나가 곧 release이므로 dataset 진행을 기록한 뒤
    # 바로 봉인한다. 완결성 판정 자체는 같은 DB trigger가 그대로 강제한다.
    services.release_repository.seal_release(
        plan.source_release_id, sealed_at=plan.started_at
    )
    return CodeVocabularyCaptureResult(
        observation_id=observation.observation_id,
        content_sha256=observation.content_sha256,
        source_release_id=plan.source_release_id,
        entry_count=len(vocabulary.entries),
        excluded_row_count=vocabulary.excluded_row_count,
        release_name=plan.release_name,
    )


def project_code_vocabulary_observation(
    cursor: Any,
    *,
    store: Any,
    source_release_id: UUID,
    observation_id: int,
    parser_version: str,
    projected_at: datetime,
) -> CodeVocabularyProjectionResult:
    """봉인된 관측을 R2에서 다시 읽어 이름과 유효기간을 core에 앉힌다.

    capture가 들고 있던 파싱 결과를 넘겨받지 않고 다시 읽는 이유는, 투영이 언제나 **보존된 원본**을
    입력으로 삼아야 재실행과 replay가 같은 결과를 내기 때문이다(AGENTS 3).
    """
    _require_sealed_release(cursor, source_release_id)
    contract = require(CODE_LIST_ENDPOINT, parser_version=parser_version)
    object_key, content_sha256, observed_at = _observation_object(cursor, observation_id)
    vocabulary = read_code_vocabulary(
        store,
        object_key=object_key,
        content_sha256=content_sha256,
        contract=contract,
    )
    return project_code_vocabulary(
        cursor,
        vocabulary,
        observation_id=observation_id,
        # 이름을 언제 들었는가는 관측 시각이지 투영 시각이 아니다. 관측 시각이 없으면 그때서야
        # 투영 시각으로 대신한다 — 그 경우가 생기면 라벨의 최신성 정렬이 실행 순서를 따른다.
        observed_at=observed_at or projected_at,
    )


def read_code_vocabulary(
    store: Any,
    *,
    object_key: str,
    content_sha256: str,
    contract: EatEndpointContract,
) -> EatbidCodeVocabularyV1:
    """보존된 원본 바이트를 검토된 계약으로 읽어 어휘 한 벌로 만든다.

    지문을 여기서 대조하는 이유는 코드목록에 격리 단위가 없기 때문이다. 공고는 건별로 격리해 나머지를
    발행할 수 있지만 어휘는 한 벌이 통째로 활성 이름이 되므로, 모양이 달라진 응답은 일부를 싣는 대신
    전체를 멈춘다.
    """
    raw = store.read(object_key)
    if sha256(raw).hexdigest() != content_sha256:
        raise SourceContractError(
            "eaT code list raw bytes do not match the committed content address"
        )
    parsed = parse_nexacro(raw)
    observed = contract.schema_contract.observed_fingerprint(parsed.datasets)
    if observed != contract.schema_fingerprint:
        raise SourceContractError(
            "eaT code list response shape changed "
            f"[expected={contract.schema_fingerprint} observed={observed}]"
        )
    return parse_code_vocabulary(parsed)


def _require_sealed_release(cursor: Any, source_release_id: UUID) -> None:
    """봉인되지 않은 입력으로 canonical 행을 공개하지 않는다(AGENTS 변경 절차)."""
    cursor.execute(
        "select status from ingest.source_release where source_release_id = %s",
        (str(source_release_id),),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError("source release is missing")
    if row[0] != "sealed":
        raise ProjectionContractError("source release is not sealed")


def _observation_object(
    cursor: Any, observation_id: int
) -> tuple[str, str, datetime | None]:
    cursor.execute(
        """
        select b.object_key, o.content_sha256, o.fetched_at
        from ingest.raw_observation o
        join ingest.raw_blob b using (content_sha256)
        where o.observation_id = %s
        """,
        (observation_id,),
    )
    row = cursor.fetchone()
    if row is None:
        raise ProjectionContractError("code list observation is missing")
    return str(row[0]), str(row[1]), row[2]
