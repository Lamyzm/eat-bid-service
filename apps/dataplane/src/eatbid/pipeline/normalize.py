from __future__ import annotations

from datetime import datetime
from hashlib import sha256
from uuid import UUID

from eatbid.ingest.normalization_repository import (
    NormalizationRepository,
    StoredNormalizedRecord,
)
from eatbid.object_store import RawObjectStore
from eatbid.source.eat.normalize import (
    EatDetailValidationError,
    canonical_payload,
    normalize_bid_detail_payload,
)
from eatbid.source.eat.xml import NexacroParseError

DATA_QUARANTINED = "DATA_QUARANTINED"
DATA_QUARANTINED_EXIT_CODE = 65


class RawObjectIntegrityError(RuntimeError):
    """Restored raw bytes do not match the committed content address."""


class DataQuarantinedError(RuntimeError):
    exit_code = DATA_QUARANTINED_EXIT_CODE

    def __init__(self, observation_id: int, reason: str) -> None:
        super().__init__(reason)
        self.observation_id = observation_id


def normalize_observation(
    *,
    processing_run_id: UUID,
    observation_id: int,
    parser_version: str,
    normalized_at: datetime,
    store: RawObjectStore,
    repository: NormalizationRepository,
) -> StoredNormalizedRecord:
    observation = repository.load_observation(
        processing_run_id=processing_run_id,
        observation_id=observation_id,
    )
    if observation.request_params != observation.planned_request_params:
        raise RawObjectIntegrityError("observation request identity differs from its plan")
    if parser_version != observation.processing_parser_version:
        raise RawObjectIntegrityError("parser version differs from the processing run")
    external_bid_id = observation.planned_request_params.get("ELCTRN_BID_ID")
    if not isinstance(external_bid_id, str) or not external_bid_id:
        raise RawObjectIntegrityError("planned ELCTRN_BID_ID is required")

    raw = store.read(observation.object_key)
    if sha256(raw).hexdigest() != observation.content_sha256:
        raise RawObjectIntegrityError("restored raw bytes do not match content_sha256")
    try:
        normalized = normalize_bid_detail_payload(
            raw,
            external_bid_id=external_bid_id,
            parser_version=parser_version,
        )
    except (NexacroParseError, EatDetailValidationError) as error:
        fingerprint = getattr(error, "schema_fingerprint", None)
        repository.quarantine(
            observation=observation,
            reason=str(error),
            schema_fingerprint=fingerprint,
            attempted_at=normalized_at,
        )
        raise DataQuarantinedError(observation_id, str(error)) from error

    return repository.store_normalized(
        observation=observation,
        record_type="auction",
        source_entity_id=external_bid_id,
        parser_version=parser_version,
        canonical_payload=canonical_payload(normalized.record),
        schema_fingerprint=normalized.schema_fingerprint,
        attempted_at=normalized_at,
    )
