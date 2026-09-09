"""모듈 책임: source release 계획·진행·봉인 값의 경계 불변식을 소유한다."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from pydantic import (
    AfterValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from pydantic.dataclasses import dataclass

Sha256 = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
NonnegativeCount = Annotated[int, Field(strict=True, ge=0)]
PositiveObservationId = Annotated[int, Field(strict=True, ge=1)]


def _utc_datetime(value: datetime) -> datetime:
    if value.utcoffset() is None:
        raise ValueError("datetime must be timezone-aware")
    return value.astimezone(UTC)


AwareUtcDatetime = Annotated[datetime, AfterValidator(_utc_datetime)]


_RELEASE_CONFIG = ConfigDict(extra="forbid", strict=True)


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class ReleaseDatasetPlan:
    endpoint: str = Field(min_length=1)
    dataset: str = Field(min_length=1, max_length=128)
    record_type: str = Field(min_length=1, max_length=64)
    parser_version: str = Field(min_length=1, max_length=128)
    schema_fingerprint: Sha256
    expected_count: NonnegativeCount
    observed_count: NonnegativeCount
    normalized_count: NonnegativeCount
    quarantined_count: NonnegativeCount
    required: bool

    @model_validator(mode="after")
    def validate_count_grain(self) -> ReleaseDatasetPlan:
        if self.observed_count > self.expected_count:
            raise ValueError("observed_count must not exceed expected_count")
        if self.normalized_count + self.quarantined_count > self.observed_count:
            raise ValueError("terminal counts must not exceed observed_count")
        return self


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class ReleaseDatasetProgress:
    dataset: str = Field(min_length=1, max_length=128)
    observed_count: NonnegativeCount
    normalized_count: NonnegativeCount
    quarantined_count: NonnegativeCount

    @model_validator(mode="after")
    def validate_terminal_counts(self) -> ReleaseDatasetProgress:
        if self.normalized_count + self.quarantined_count > self.observed_count:
            raise ValueError("terminal counts must not exceed observed_count")
        return self


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class ReleaseCompleteness(ReleaseDatasetPlan):
    @property
    def is_complete(self) -> bool:
        return self.observed_count == self.expected_count and (
            self.normalized_count + self.quarantined_count == self.observed_count
        )


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class SourceReleasePlan:
    source_release_id: UUID
    source: str = Field(min_length=1, max_length=64, pattern=r"^[a-z0-9-]+$")
    release_name: str = Field(min_length=1, max_length=128)
    as_of: AwareUtcDatetime
    datasets: tuple[ReleaseDatasetPlan, ...] = Field(min_length=1)

    @field_validator("release_name")
    @classmethod
    def validate_release_name(cls, value: str) -> str:
        if value.strip() != value:
            raise ValueError("release_name must not have surrounding whitespace")
        return value

    @model_validator(mode="after")
    def validate_unique_datasets(self) -> SourceReleasePlan:
        names = [dataset.dataset for dataset in self.datasets]
        if len(names) != len(set(names)):
            raise ValueError("datasets must be unique by dataset")
        return self


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class ReleaseObservation:
    observation_id: PositiveObservationId
    content_sha256: Sha256


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class SealedSourceRelease:
    source_release_id: UUID
    source: str
    as_of: AwareUtcDatetime
    manifest_sha256: Sha256
    sealed_at: AwareUtcDatetime


@dataclass(frozen=True, slots=True, kw_only=True, config=_RELEASE_CONFIG)
class FailedSourceRelease:
    """운영자가 닫은 release다. 같은 transaction에서 함께 닫힌 run이 어느 것인지도 결과에 남긴다."""

    source_release_id: UUID
    source: str
    as_of: AwareUtcDatetime
    failure_category: str = Field(min_length=1, max_length=64)
    closed_run_ids: tuple[UUID, ...]
