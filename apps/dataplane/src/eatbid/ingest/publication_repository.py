"""모듈 책임: publication 완결 검증의 port와 검증기 계약, 그리고 validate가 돌려주는 결과 모양을 소유한다."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID


@dataclass(frozen=True, slots=True)
class QuarantinedRecord:
    """현재 parser로 격리된 관측 하나와 저장된 격리 사유다. 완결 검증기가 범위를 가르는 재료다."""

    observation_id: int
    reason: str


@dataclass(frozen=True, slots=True)
class RecordExclusion:
    """발행에서 빼고 원장에 `normalize` 단계로 적을 레코드 하나다(ADR 0061 결정 4).

    `reason_code`는 검증기가 레코드 범위로 열거한 코드뿐이다. 저장소는 이 값을 고르지 않고 그대로 적는다.
    """

    observation_id: int
    reason_code: str
    reason: str


class CompletenessResult(Protocol):
    @property
    def publishable(self) -> bool: ...

    @property
    def failure_category(self) -> str | None: ...

    # 발행 가능할 때만 비어 있지 않다. 격리마다 정확히 한 항목이며 저장소가 원장에 그대로 옮긴다.
    @property
    def exclusions(self) -> tuple[RecordExclusion, ...]: ...


class CompletenessValidator(Protocol):
    def __call__(
        self,
        *,
        request_counts: tuple[tuple[int, int], ...],
        expected_count: int,
        normalized: int,
        quarantined: tuple[QuarantinedRecord, ...],
        duplicate_source_entities: int,
        missing_code_schemes: tuple[str, ...],
        schema_contract_violations: int,
    ) -> CompletenessResult: ...


class SourceContractValidator(Protocol):
    def __call__(
        self,
        *,
        source: str,
        endpoint: str,
        parser_version: str,
        schema_fingerprint: str | None,
    ) -> bool: ...


@dataclass(frozen=True, slots=True)
class PublicationValidation:
    publication_id: UUID
    run_id: UUID
    status: str
    expected_count: int
    normalized_count: int
    member_ids: tuple[int, ...]
    # 원장에 적고 발행에서 뺀 레코드 수(ADR 0061). validated면 `expected_count = normalized_count + excluded_count`
    # 이고, 검증 전에 실패한 발행은 제외를 적지 않으므로 0이다.
    excluded_count: int = 0
    # failed일 때만 값이 있다. validate 프로세스가 이 값으로 exit code를 정하므로 ledger에 기록한
    # category와 같은 문자열이어야 한다.
    failure_category: str | None = None


class PublicationRepository(Protocol):
    def validate_run(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        validated_at: datetime,
        completeness_validator: CompletenessValidator,
        source_contract_validator: SourceContractValidator,
    ) -> PublicationValidation: ...
