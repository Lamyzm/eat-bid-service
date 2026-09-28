"""모듈 책임: 실행 하나가 발행될 수 있는지의 완결 판정 — 창 전체 결함의 열거와 레코드 범위 격리를 제외로
넘기는 조건 — 을 소유하고 그 규칙으로 발행 검증을 부른다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from uuid import UUID

from eatbid.ingest.publication_repository import (
    PublicationRepository,
    PublicationValidation,
    QuarantinedRecord,
    RecordExclusion,
)
from eatbid.pipeline.exclusion_scope import (
    allowed_exclusions,
    record_scoped_reason_code,
)
from eatbid.source.eat.schema_contract import validate_eat_schema_contract

SOURCE_CONTRACT = "SOURCE_CONTRACT"


class WindowDefect(StrEnum):
    """발행 전체를 막는 창 전체의 결함이다(ADR 0061 결정 2). 하나라도 있으면 제외로 넘기지 않는다.

    이 검증기가 인자로 받는 사실만 여기 있다. 실패한 요청 단위, 후보 수와 run 기대 수의 불일치,
    `parser_version` 불일치, 시도·구성원 lineage 결함, 모르는 `record_type`은 저장소가 잠근 topology로
    판정하고(`ledger_coherent`), chronology·fingerprint 불일치는 투영이 발행 전체를 실패시킨다. 어느 쪽에도
    레코드 범위의 길은 없다.
    """

    # 요청 단위의 기대 수(소스 TOT_CNT)와 관측 수가 다르다. 봉인 조건이다(ADR 0025).
    REQUEST_COUNT_MISMATCH = "request-count-mismatch"
    # 정규화와 격리를 합쳐도 관측 수가 안 된다 — 최종 시도가 없는 관측이 있다.
    UNSETTLED_OBSERVATIONS = "unsettled-observations"
    DUPLICATE_SOURCE_ENTITY = "duplicate-source-entity"
    MISSING_CODE_SCHEME = "missing-code-scheme"
    # 해석에 성공한 레코드가 검토되지 않은 응답 schema를 들고 있다. 격리된 관측의 지문은 여기 들지 않는다 —
    # 그 관측이 깨졌다는 기록이라 범위가 그 한 건이다.
    SOURCE_CONTRACT = "source-contract"
    # 레코드 범위로 열거되지 않은 격리 사유다. 기본값이 창 전체 실패인 자리다.
    UNCLASSIFIED_QUARANTINE = "unclassified-quarantine"
    # 레코드 범위라도 허용 수를 넘었다. 우연이 아니라 계약·파서 결함으로 본다(ADR 0061 결정 3).
    EXCLUSION_CAP_EXCEEDED = "exclusion-cap-exceeded"


@dataclass(frozen=True, slots=True)
class CompletenessReport:
    publishable: bool
    failure_category: str | None
    # 발행 가능할 때만 값이 있다. 결함이 하나라도 있으면 격리는 제외가 아니라 실패의 일부다.
    exclusions: tuple[RecordExclusion, ...] = ()
    window_defects: tuple[WindowDefect, ...] = ()


def validate_completeness(
    *,
    request_counts: tuple[tuple[int, int], ...],
    expected_count: int,
    normalized: int,
    quarantined: tuple[QuarantinedRecord, ...],
    duplicate_source_entities: int,
    missing_code_schemes: tuple[str, ...],
    schema_contract_violations: int,
) -> CompletenessReport:
    """창 전체 결함이 하나라도 있으면 발행을 막고, 없으면 레코드 범위 격리를 상한 안에서 제외로 넘긴다.

    판정은 오류 종류가 아니라 범위로 한다(ADR 0061 결정 2). 격리가 없으면 결과는 ADR 0061 이전과 같다.
    """
    for pair in request_counts:
        if len(pair) != 2:
            raise ValueError("each request count must contain expected and observed")
        _require_nonnegative(pair[0], "expected request count")
        _require_nonnegative(pair[1], "observed request count")
    _require_nonnegative(expected_count, "expected_count")
    _require_nonnegative(normalized, "normalized")
    _require_nonnegative(duplicate_source_entities, "duplicate_source_entities")
    _require_nonnegative(schema_contract_violations, "schema_contract_violations")
    if any(not isinstance(scheme, str) or not scheme for scheme in missing_code_schemes):
        raise ValueError("missing code schemes must be nonempty strings")
    observation_ids = [record.observation_id for record in quarantined]
    if len(observation_ids) != len(set(observation_ids)):
        raise ValueError("each quarantined observation must appear once")

    defects: list[WindowDefect] = []
    if not all(expected == observed for expected, observed in request_counts):
        defects.append(WindowDefect.REQUEST_COUNT_MISMATCH)
    # 격리된 관측도 관측이다. 정규화와 격리를 합쳐 관측 수와 같아야 "모든 관측이 최종 상태에 닿았다"가 된다.
    if sum(observed for _, observed in request_counts) != normalized + len(quarantined):
        defects.append(WindowDefect.UNSETTLED_OBSERVATIONS)
    if duplicate_source_entities:
        defects.append(WindowDefect.DUPLICATE_SOURCE_ENTITY)
    if missing_code_schemes:
        defects.append(WindowDefect.MISSING_CODE_SCHEME)
    if schema_contract_violations:
        defects.append(WindowDefect.SOURCE_CONTRACT)

    exclusions: list[RecordExclusion] = []
    for record in quarantined:
        code = record_scoped_reason_code(record.reason)
        if code is None:
            defects.append(WindowDefect.UNCLASSIFIED_QUARANTINE)
            break
        exclusions.append(
            RecordExclusion(
                observation_id=record.observation_id,
                reason_code=code,
                reason=record.reason,
            )
        )
    if len(quarantined) > allowed_exclusions(expected_count):
        defects.append(WindowDefect.EXCLUSION_CAP_EXCEEDED)

    if defects:
        return CompletenessReport(
            publishable=False,
            failure_category=SOURCE_CONTRACT,
            window_defects=tuple(defects),
        )
    return CompletenessReport(
        publishable=True,
        failure_category=None,
        exclusions=tuple(sorted(exclusions, key=lambda item: item.observation_id)),
    )


def validate_run(
    *,
    run_id: UUID,
    publication_id: UUID,
    validated_at: datetime,
    repository: PublicationRepository,
) -> PublicationValidation:
    return repository.validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=validated_at,
        completeness_validator=validate_completeness,
        source_contract_validator=validate_eat_schema_contract,
    )


def _require_nonnegative(value: int, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field} must be a nonnegative integer")
