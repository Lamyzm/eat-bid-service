"""모듈 책임: normalize 단계가 대기 관측을 읽고 정규화 시도·레코드를 앉히는 저장소 port와 그 교환 record 모양을
소유한다. PostgreSQL 구현은 postgres_normalization_repository가 갖고 여기는 계약만 둔다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from eatbid.storage.object_store import RawObjectStore


@dataclass(frozen=True, slots=True)
class ObservationForNormalization:
    processing_run_id: UUID
    processing_mode: str
    processing_parser_version: str
    observation_id: int
    capture_run_id: UUID
    source: str
    endpoint: str
    request_params: Mapping[str, str]
    planned_request_params: Mapping[str, str]
    content_sha256: str
    object_key: str


@dataclass(frozen=True, slots=True)
class StoredNormalizedRecord:
    normalization_attempt_id: int
    normalized_record_id: int
    observation_id: int
    run_id: UUID
    record_type: str
    source_entity_id: str
    parser_version: str
    canonical_payload: bytes
    schema_fingerprint: str


class NormalizationRepository(Protocol):
    def load_observation(
        self, *, processing_run_id: UUID, observation_id: int
    ) -> ObservationForNormalization: ...

    def store_normalized(
        self,
        *,
        observation: ObservationForNormalization,
        record_type: str,
        source_entity_id: str,
        parser_version: str,
        canonical_payload: bytes,
        schema_fingerprint: str,
        attempted_at: datetime,
    ) -> StoredNormalizedRecord: ...

    def quarantine(
        self,
        *,
        observation: ObservationForNormalization,
        reason: str,
        schema_fingerprint: str | None,
        attempted_at: datetime,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class NormalizationServices:
    repository: NormalizationRepository
    store: RawObjectStore
