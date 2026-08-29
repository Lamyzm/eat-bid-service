from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from eatbid.ingest.publication_repository import (
    PublicationRepository,
    PublicationValidation,
)

SOURCE_CONTRACT = "SOURCE_CONTRACT"


@dataclass(frozen=True, slots=True)
class CompletenessReport:
    publishable: bool
    failure_category: str | None


def validate_completeness(
    *,
    request_counts: tuple[tuple[int, int], ...],
    normalized: int,
    quarantined: int,
    duplicate_source_entities: int,
    missing_code_schemes: tuple[str, ...],
) -> CompletenessReport:
    for pair in request_counts:
        if len(pair) != 2:
            raise ValueError("each request count must contain expected and observed")
        _require_nonnegative(pair[0], "expected request count")
        _require_nonnegative(pair[1], "observed request count")
    _require_nonnegative(normalized, "normalized")
    _require_nonnegative(quarantined, "quarantined")
    _require_nonnegative(duplicate_source_entities, "duplicate_source_entities")
    if any(not isinstance(scheme, str) or not scheme for scheme in missing_code_schemes):
        raise ValueError("missing code schemes must be nonempty strings")

    publishable = (
        all(expected == observed for expected, observed in request_counts)
        and sum(observed for _, observed in request_counts) == normalized
        and quarantined == 0
        and duplicate_source_entities == 0
        and not missing_code_schemes
    )
    return CompletenessReport(
        publishable=publishable,
        failure_category=None if publishable else SOURCE_CONTRACT,
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
    )


def _require_nonnegative(value: int, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"{field} must be a nonnegative integer")
