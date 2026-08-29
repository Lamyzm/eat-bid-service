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
    ) -> CompletenessResult: ...


@dataclass(frozen=True, slots=True)
class PublicationValidation:
    publication_id: UUID
    run_id: UUID
    status: str
    expected_count: int
    normalized_count: int
    member_ids: tuple[int, ...]


class PublicationRepository(Protocol):
    def validate_run(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        validated_at: datetime,
        completeness_validator: CompletenessValidator,
    ) -> PublicationValidation: ...

    def add_replay_input(self, *, run_id: UUID, observation_id: int) -> None: ...
