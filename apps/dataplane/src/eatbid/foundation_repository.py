from __future__ import annotations

from collections.abc import Mapping
from contextlib import AbstractContextManager
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from eatbid.ingest.repository import CaptureRunMode


class FoundationIntegrityError(RuntimeError):
    """A persisted or adapter-returned foundation checkpoint is inconsistent."""


@dataclass(frozen=True, slots=True)
class FoundationRequestCheckpoint:
    request_unit_id: int
    run_id: UUID
    source: str
    endpoint: str
    params: Mapping[str, str]
    request_params_hash: str
    expected_count: int
    observed_count: int
    status: str


@dataclass(frozen=True, slots=True)
class FoundationObservationCheckpoint:
    observation_id: int
    run_id: UUID
    request_unit_id: int
    source: str
    endpoint: str
    params: Mapping[str, str]
    fetched_at: datetime
    http_status: int
    content_sha256: str
    object_key: str
    byte_length: int


@dataclass(frozen=True, slots=True)
class FoundationNormalizationCheckpoint:
    normalization_attempt_id: int
    observation_id: int
    parser_version: str
    status: str
    normalized_record_id: int | None
    record_type: str | None
    source_entity_id: str | None
    canonical_payload: bytes | None
    schema_fingerprint: str | None
    quarantine_reason: str | None


@dataclass(frozen=True, slots=True)
class FoundationPublicationCheckpoint:
    publication_id: UUID
    run_id: UUID
    status: str
    expected_count: int
    normalized_count: int
    published_count: int
    member_ids: tuple[int, ...]
    canonical_fingerprint: str | None
    projector_version: str | None


@dataclass(frozen=True, slots=True)
class FoundationPublishedEvidence:
    capture_run_id: UUID
    publication_id: UUID
    request_unit_id: int
    observation_ids: tuple[int, ...]
    raw_content_sha256: str
    raw_object_key: str
    raw_blob_count: int
    observation_count: int
    publication_status: str


@dataclass(frozen=True, slots=True)
class FoundationCheckpoint:
    run_id: UUID
    mode: str
    status: str
    build_sha: str
    parser_version: str
    started_at: datetime
    expected_count: int
    captured_count: int
    published_count: int
    failure_category: str | None
    ended_at: datetime | None
    request: FoundationRequestCheckpoint
    observation: FoundationObservationCheckpoint | None
    normalization: FoundationNormalizationCheckpoint | None
    publication: FoundationPublicationCheckpoint
    evidence: FoundationPublishedEvidence | None


class FoundationCheckpointRepository(Protocol):
    def run_lock(self, *, run_id: UUID) -> AbstractContextManager[None]: ...

    def start_or_load(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        mode: CaptureRunMode,
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        source: str,
        endpoint: str,
        request_params: Mapping[str, str],
        expected_count: int,
    ) -> FoundationCheckpoint: ...

    def load(self, *, run_id: UUID) -> FoundationCheckpoint: ...
