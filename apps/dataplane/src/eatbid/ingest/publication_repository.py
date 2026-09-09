"""모듈 책임: publication 완결 검증의 port와 검증기 계약, 그리고 validate가 돌려주는 결과 모양을 소유한다."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID


class CompletenessResult(Protocol):
    @property
    def publishable(self) -> bool: ...

    @property
    def failure_category(self) -> str | None: ...


class CompletenessValidator(Protocol):
    def __call__(
        self,
        *,
        request_counts: tuple[tuple[int, int], ...],
        normalized: int,
        quarantined: int,
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
