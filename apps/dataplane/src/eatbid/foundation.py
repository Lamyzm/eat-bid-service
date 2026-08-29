from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict
from uuid import UUID

from eatbid.core.models import ProjectResult
from eatbid.core.repository import (
    CanonicalProjectionRepository,
    ProjectionContractError,
    PublishedProjectionEvidence,
)
from eatbid.errors import SourceContractError
from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationCheckpointRepository,
    FoundationIntegrityError,
    FoundationPublishedEvidence,
)
from eatbid.ingest.models import CapturedObservation, CaptureRequest
from eatbid.ingest.normalization_repository import (
    NormalizationRepository,
    StoredNormalizedRecord,
)
from eatbid.ingest.publication_repository import (
    PublicationRepository,
    PublicationValidation,
)
from eatbid.ingest.replay_repository import validate_processing_start
from eatbid.ingest.repository import (
    CaptureRunMode,
    IngestRepository,
    request_params_sha256,
)
from eatbid.object_store import RawObjectStore
from eatbid.pipeline.capture import (
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    SourceThrottledError,
    capture,
)
from eatbid.pipeline.normalize import (
    DATA_QUARANTINED,
    DataQuarantinedError,
    normalize_observation,
)
from eatbid.pipeline.project import project_publication, verify_published_publication
from eatbid.pipeline.stages import validate_stage_timestamps
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceClient

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
_CAPTURE_MODES = {"poll-open", "daily-reconcile", "backfill"}


class _FoundationIdentity(TypedDict):
    run_id: UUID
    publication_id: UUID
    mode: CaptureRunMode
    build_sha: str
    parser_version: str
    started_at: datetime
    source: str
    endpoint: str
    params: dict[str, str]
    expected_count: int


@dataclass(frozen=True, slots=True)
class FoundationServices:
    checkpoint_repository: FoundationCheckpointRepository
    ingest_repository: IngestRepository
    normalization_repository: NormalizationRepository
    publication_repository: PublicationRepository
    projection_repository: CanonicalProjectionRepository
    raw_store: RawObjectStore
    source_client: SourceClient


@dataclass(frozen=True, slots=True)
class FoundationResult:
    capture_run_id: UUID
    publication_id: UUID
    request_unit_id: int
    observation_ids: tuple[int, ...]
    raw_content_sha256: str
    raw_object_key: str
    raw_blob_count: int
    observation_count: int
    publication_status: str
    organization_count: int
    auction_attempt_count: int
    auction_revision_count: int
    canonical_fingerprint: str


def run_foundation_slice(
    *,
    run_id: UUID,
    publication_id: UUID,
    mode: CaptureRunMode,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    normalized_at: datetime,
    validated_at: datetime,
    activated_at: datetime,
    source: str,
    endpoint: str,
    request_params: Mapping[str, str],
    expected_count: int,
    services: FoundationServices,
) -> FoundationResult:
    _preflight(
        run_id=run_id,
        publication_id=publication_id,
        mode=mode,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        normalized_at=normalized_at,
        validated_at=validated_at,
        activated_at=activated_at,
        source=source,
        endpoint=endpoint,
        request_params=request_params,
        expected_count=expected_count,
    )
    with services.checkpoint_repository.run_lock(run_id=run_id):
        return _run_foundation_slice_locked(
            run_id=run_id,
            publication_id=publication_id,
            mode=mode,
            build_sha=build_sha,
            parser_version=parser_version,
            started_at=started_at,
            normalized_at=normalized_at,
            validated_at=validated_at,
            activated_at=activated_at,
            source=source,
            endpoint=endpoint,
            request_params=request_params,
            expected_count=expected_count,
            services=services,
        )


def _run_foundation_slice_locked(
    *,
    run_id: UUID,
    publication_id: UUID,
    mode: CaptureRunMode,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    normalized_at: datetime,
    validated_at: datetime,
    activated_at: datetime,
    source: str,
    endpoint: str,
    request_params: Mapping[str, str],
    expected_count: int,
    services: FoundationServices,
) -> FoundationResult:
    params = _preflight(
        run_id=run_id,
        publication_id=publication_id,
        mode=mode,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        normalized_at=normalized_at,
        validated_at=validated_at,
        activated_at=activated_at,
        source=source,
        endpoint=endpoint,
        request_params=request_params,
        expected_count=expected_count,
    )
    identity: _FoundationIdentity = {
        "run_id": run_id,
        "publication_id": publication_id,
        "mode": mode,
        "build_sha": build_sha,
        "parser_version": parser_version,
        "started_at": started_at,
        "source": source,
        "endpoint": endpoint,
        "params": params,
        "expected_count": expected_count,
    }
    checkpoint = services.checkpoint_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        mode=mode,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        source=source,
        endpoint=endpoint,
        request_params=params,
        expected_count=expected_count,
    )
    _verify_checkpoint(checkpoint, **identity)
    if checkpoint.status == "failed":
        _raise_stored_failure(checkpoint)
    if checkpoint.status == "published":
        projection_evidence = _load_verified_projection_evidence(
            checkpoint=checkpoint,
            projector_version=build_sha,
            repository=services.projection_repository,
        )
        return _result_from_checkpoint(checkpoint, projection_evidence)

    if checkpoint.status == "running" and checkpoint.observation is None:
        request = checkpoint.request
        observed = capture(
            CaptureRequest(
                request.request_unit_id,
                request.run_id,
                request.source,
                request.endpoint,
                request.params,
            ),
            services.raw_store,
            services.ingest_repository,
            services.source_client,
        )
        _verify_capture_result(observed)
        checkpoint = _reload_and_verify(
            services.checkpoint_repository,
            observation_id=observed.observation_id,
            **identity,
        )

    if checkpoint.status == "running" and checkpoint.normalization is None:
        if checkpoint.observation is None:
            raise FoundationIntegrityError(
                "foundation cannot normalize without an observation"
            )
        try:
            normalized = normalize_observation(
                processing_run_id=run_id,
                observation_id=checkpoint.observation.observation_id,
                parser_version=parser_version,
                normalized_at=normalized_at,
                store=services.raw_store,
                repository=services.normalization_repository,
            )
            _verify_normalization_result(
                normalized,
                run_id=run_id,
                observation_id=checkpoint.observation.observation_id,
                parser_version=parser_version,
            )
        except DataQuarantinedError:
            pass
        checkpoint = _reload_and_verify(services.checkpoint_repository, **identity)

    if checkpoint.status == "running":
        validation = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=validated_at,
            repository=services.publication_repository,
        )
        _verify_validation_result(validation, checkpoint=checkpoint)
        if validation.status == "failed":
            checkpoint = _reload_and_verify(
                services.checkpoint_repository,
                required_status="failed",
                **identity,
            )
            _raise_stored_failure(checkpoint)
        checkpoint = _reload_and_verify(
            services.checkpoint_repository,
            required_status="validated",
            **identity,
        )

    if checkpoint.status != "validated":
        raise FoundationIntegrityError("foundation checkpoint cannot be projected")
    projected = project_publication(
        publication_id=publication_id,
        projector_version=build_sha,
        activated_at=activated_at,
        repository=services.projection_repository,
    )
    _verify_project_result(projected, checkpoint=checkpoint)
    checkpoint = _reload_and_verify(
        services.checkpoint_repository,
        required_status="published",
        **identity,
    )
    projection_evidence = _load_verified_projection_evidence(
        checkpoint=checkpoint,
        projector_version=build_sha,
        repository=services.projection_repository,
    )
    if projection_evidence.canonical_fingerprint != projected.canonical_fingerprint:
        raise FoundationIntegrityError(
            "projector fingerprint differs from persisted evidence"
        )
    return _result_from_checkpoint(checkpoint, projection_evidence)


def _preflight(
    *,
    run_id: UUID,
    publication_id: UUID,
    mode: CaptureRunMode,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    normalized_at: datetime,
    validated_at: datetime,
    activated_at: datetime,
    source: str,
    endpoint: str,
    request_params: Mapping[str, str],
    expected_count: int,
) -> dict[str, str]:
    validate_processing_start(
        run_id=run_id,
        publication_id=publication_id,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
    )
    validate_stage_timestamps(
        started_at=started_at,
        normalized_at=normalized_at,
        validated_at=validated_at,
        activated_at=activated_at,
    )
    if mode not in _CAPTURE_MODES:
        raise ValueError("foundation mode must be a capture mode")
    if (
        isinstance(expected_count, bool)
        or not isinstance(expected_count, int)
        or expected_count < 0
    ):
        raise ValueError("expected_count must be a nonnegative integer")
    return dict(CaptureRequest(1, run_id, source, endpoint, request_params).params)


def _reload_and_verify(
    repository: FoundationCheckpointRepository,
    *,
    run_id: UUID,
    publication_id: UUID,
    mode: CaptureRunMode,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    source: str,
    endpoint: str,
    params: dict[str, str],
    expected_count: int,
    observation_id: int | None = None,
    required_status: str | None = None,
) -> FoundationCheckpoint:
    checkpoint = repository.load(run_id=run_id)
    _verify_checkpoint(
        checkpoint,
        run_id=run_id,
        publication_id=publication_id,
        mode=mode,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        source=source,
        endpoint=endpoint,
        params=params,
        expected_count=expected_count,
    )
    if observation_id is not None and (
        checkpoint.observation is None
        or checkpoint.observation.observation_id != observation_id
    ):
        raise FoundationIntegrityError(
            "capture result differs from persisted observation"
        )
    if required_status is not None and checkpoint.status != required_status:
        raise FoundationIntegrityError(f"foundation did not reach {required_status}")
    return checkpoint


def _verify_checkpoint(
    checkpoint: object,
    *,
    run_id: UUID,
    publication_id: UUID,
    mode: CaptureRunMode,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    source: str,
    endpoint: str,
    params: dict[str, str],
    expected_count: int,
) -> None:
    if not isinstance(checkpoint, FoundationCheckpoint):
        raise FoundationIntegrityError(
            "checkpoint repository returned an unsupported result"
        )
    request, publication = checkpoint.request, checkpoint.publication
    if (
        checkpoint.run_id != run_id
        or checkpoint.mode != mode
        or checkpoint.status not in {"running", "validated", "published", "failed"}
        or checkpoint.build_sha != build_sha
        or checkpoint.parser_version != parser_version
        or checkpoint.started_at != started_at
        or checkpoint.expected_count != expected_count
        or request.run_id != run_id
        or request.source != source
        or request.endpoint != endpoint
        or dict(request.params) != params
        or request.request_params_hash != request_params_sha256(params)
        or request.expected_count != expected_count
        or publication.run_id != run_id
        or publication.publication_id != publication_id
        or publication.expected_count != expected_count
    ):
        raise FoundationIntegrityError(
            "checkpoint returned a different frozen identity"
        )
    _positive_int(request.request_unit_id, "request_unit_id")
    _nonnegative_int(request.observed_count, "request observed_count")
    _nonnegative_int(checkpoint.captured_count, "captured_count")
    _nonnegative_int(checkpoint.published_count, "published_count")
    if checkpoint.observation is not None:
        observation = checkpoint.observation
        _positive_int(observation.observation_id, "observation_id")
        if (
            observation.run_id != run_id
            or observation.request_unit_id != request.request_unit_id
            or observation.source != source
            or observation.endpoint != endpoint
            or dict(observation.params) != params
        ):
            raise FoundationIntegrityError("observation differs from frozen request")
    observed_count = int(checkpoint.observation is not None)
    if (
        request.observed_count != observed_count
        or checkpoint.captured_count != observed_count
    ):
        raise FoundationIntegrityError("checkpoint capture counts are inconsistent")
    if checkpoint.status == "running":
        expected_request_status = "planned" if observed_count == 0 else "captured"
        if (
            request.status != expected_request_status
            or publication.status != "pending"
            or publication.normalized_count != 0
            or publication.published_count != 0
            or publication.member_ids
        ):
            raise FoundationIntegrityError("running checkpoint status is inconsistent")
    elif checkpoint.status == "validated":
        normalized_id = (
            checkpoint.normalization.normalized_record_id
            if checkpoint.normalization is not None
            else None
        )
        if (
            request.status != "captured"
            or observed_count != 1
            or normalized_id is None
            or publication.status != "validated"
            or publication.normalized_count != 1
            or publication.published_count != 0
            or publication.member_ids != (normalized_id,)
        ):
            raise FoundationIntegrityError(
                "validated checkpoint status is inconsistent"
            )
    elif checkpoint.status == "published":
        normalization = checkpoint.normalization
        normalized_id = (
            normalization.normalized_record_id
            if normalization is not None and normalization.status == "normalized"
            else None
        )
        if (
            request.status != "captured"
            or observed_count != 1
            or normalized_id is None
            or checkpoint.observation is None
            or normalization is None
            or normalization.observation_id
            != checkpoint.observation.observation_id
            or checkpoint.failure_category is not None
            or checkpoint.ended_at is None
            or publication.status != "published"
            or publication.member_ids != (normalized_id,)
            or publication.projector_version != build_sha
        ):
            raise FoundationIntegrityError(
                "published checkpoint status is inconsistent"
            )
        _verify_published_cardinality(checkpoint)
        _sha256(
            publication.canonical_fingerprint,
            "publication canonical_fingerprint",
        )
    elif checkpoint.status == "failed":
        pending_capture_failure = (
            checkpoint.normalization is None
            and checkpoint.failure_category in {SOURCE_CONTRACT, SOURCE_THROTTLED}
        )
        expected_publication_status = "pending" if pending_capture_failure else "failed"
        if (
            checkpoint.failure_category is None
            or checkpoint.ended_at is None
            or publication.status != expected_publication_status
            or request.status not in {"captured", "failed"}
        ):
            raise FoundationIntegrityError("failed checkpoint status is inconsistent")
    if checkpoint.status == "published":
        _verify_evidence(checkpoint.evidence, checkpoint=checkpoint)
    elif checkpoint.evidence is not None:
        raise FoundationIntegrityError("non-published checkpoint returned evidence")


def _verify_capture_result(result: object) -> None:
    if not isinstance(result, CapturedObservation):
        raise FoundationIntegrityError("capture port returned an unsupported result")
    _positive_int(result.observation_id, "capture observation_id")
    _sha256(result.content_sha256, "capture content_sha256")


def _verify_normalization_result(
    result: object,
    *,
    run_id: UUID,
    observation_id: int,
    parser_version: str,
) -> None:
    if not isinstance(result, StoredNormalizedRecord):
        raise FoundationIntegrityError("normalizer returned an unsupported result")
    if (
        result.run_id != run_id
        or result.observation_id != observation_id
        or result.parser_version != parser_version
    ):
        raise FoundationIntegrityError("normalization result differs from request")
    _positive_int(result.normalization_attempt_id, "normalization_attempt_id")
    _positive_int(result.normalized_record_id, "normalized_record_id")
    _sha256(result.schema_fingerprint, "schema_fingerprint")


def _verify_validation_result(
    result: object, *, checkpoint: FoundationCheckpoint
) -> None:
    if not isinstance(result, PublicationValidation):
        raise FoundationIntegrityError("validator returned an unsupported result")
    if result.status not in {"validated", "failed"}:
        raise FoundationIntegrityError("validator returned an unsupported status")
    _nonnegative_int(result.expected_count, "validation expected_count")
    _nonnegative_int(result.normalized_count, "validation normalized_count")
    normalization = checkpoint.normalization
    normalized_id = (
        normalization.normalized_record_id if normalization is not None else None
    )
    normalized_count = int(normalized_id is not None)
    members = (
        (normalized_id,)
        if result.status == "validated" and normalized_id is not None
        else ()
    )
    if (
        result.run_id != checkpoint.run_id
        or result.publication_id != checkpoint.publication.publication_id
        or result.expected_count != checkpoint.expected_count
        or result.normalized_count != normalized_count
        or result.member_ids != members
    ):
        raise FoundationIntegrityError("validator result differs from checkpoint")


def _verify_project_result(result: object, *, checkpoint: FoundationCheckpoint) -> None:
    if not isinstance(result, ProjectResult):
        raise FoundationIntegrityError("projector returned an unsupported result")
    counts = (
        result.members_projected,
        result.auction_attempts_inserted,
        result.auction_revisions_inserted,
        result.organizations_inserted,
        result.code_values_inserted,
        result.code_labels_inserted,
        result.relationships_inserted,
    )
    for count in counts:
        _nonnegative_int(count, "project count")
    if (
        result.publication_id != checkpoint.publication.publication_id
        or result.members_projected != len(checkpoint.publication.member_ids)
    ):
        raise FoundationIntegrityError("projector result differs from publication")
    _sha256(result.canonical_fingerprint, "project canonical_fingerprint")


def _verify_evidence(
    evidence: FoundationPublishedEvidence | None,
    *,
    checkpoint: FoundationCheckpoint,
) -> None:
    if not isinstance(evidence, FoundationPublishedEvidence):
        raise FoundationIntegrityError("published checkpoint lacks typed evidence")
    if (
        evidence.capture_run_id != checkpoint.run_id
        or evidence.publication_id != checkpoint.publication.publication_id
        or evidence.request_unit_id != checkpoint.request.request_unit_id
        or checkpoint.observation is None
        or evidence.observation_ids != (checkpoint.observation.observation_id,)
        or evidence.raw_content_sha256 != checkpoint.observation.content_sha256
        or evidence.raw_object_key != checkpoint.observation.object_key
        or evidence.publication_status != checkpoint.publication.status
        or evidence.raw_blob_count != 1
        or evidence.observation_count != 1
    ):
        raise FoundationIntegrityError("published evidence differs from checkpoint")
    _nonnegative_int(evidence.raw_blob_count, "evidence raw_blob_count")
    _nonnegative_int(evidence.observation_count, "evidence observation_count")
    _sha256(evidence.raw_content_sha256, "evidence raw_content_sha256")


def _load_verified_projection_evidence(
    *,
    checkpoint: FoundationCheckpoint,
    projector_version: str,
    repository: CanonicalProjectionRepository,
) -> PublishedProjectionEvidence:
    try:
        evidence = verify_published_publication(
            publication_id=checkpoint.publication.publication_id,
            projector_version=projector_version,
            repository=repository,
        )
    except ProjectionContractError as error:
        raise FoundationIntegrityError(
            "published canonical evidence failed verification"
        ) from error
    if not isinstance(evidence, PublishedProjectionEvidence):
        raise FoundationIntegrityError(
            "projection repository returned unsupported published evidence"
        )
    counts = (
        evidence.members_projected,
        evidence.organization_count,
        evidence.auction_attempt_count,
        evidence.auction_revision_count,
    )
    for count in counts:
        _nonnegative_int(count, "published projection count")
    _verify_published_cardinality(
        checkpoint,
        verified_members_projected=evidence.members_projected,
    )
    member_count = len(checkpoint.publication.member_ids)
    if (
        evidence.publication_id != checkpoint.publication.publication_id
        or evidence.organization_count != member_count
        or evidence.auction_attempt_count != member_count
        or evidence.auction_revision_count != member_count
        or evidence.canonical_fingerprint
        != checkpoint.publication.canonical_fingerprint
    ):
        raise FoundationIntegrityError(
            "published projection evidence differs from checkpoint"
        )
    _sha256(evidence.canonical_fingerprint, "published canonical_fingerprint")
    return evidence


def _verify_published_cardinality(
    checkpoint: FoundationCheckpoint,
    *,
    verified_members_projected: object | None = None,
) -> None:
    publication = checkpoint.publication
    counts: tuple[object, ...] = (
        checkpoint.expected_count,
        checkpoint.captured_count,
        checkpoint.request.expected_count,
        checkpoint.request.observed_count,
        publication.expected_count,
        publication.normalized_count,
        publication.published_count,
        len(publication.member_ids),
    )
    if verified_members_projected is not None:
        counts += (verified_members_projected,)
    for count in counts:
        _nonnegative_int(count, "published cardinality")
    if counts[0] != 1 or any(count != counts[0] for count in counts[1:]):
        raise FoundationIntegrityError(
            "published cardinality differs from the one frozen detail member"
        )


def _result_from_checkpoint(
    checkpoint: FoundationCheckpoint,
    projection_evidence: PublishedProjectionEvidence,
) -> FoundationResult:
    evidence = checkpoint.evidence
    _verify_evidence(evidence, checkpoint=checkpoint)
    assert evidence is not None
    return FoundationResult(
        capture_run_id=evidence.capture_run_id,
        publication_id=evidence.publication_id,
        request_unit_id=evidence.request_unit_id,
        observation_ids=evidence.observation_ids,
        raw_content_sha256=evidence.raw_content_sha256,
        raw_object_key=evidence.raw_object_key,
        raw_blob_count=evidence.raw_blob_count,
        observation_count=evidence.observation_count,
        publication_status=evidence.publication_status,
        organization_count=projection_evidence.organization_count,
        auction_attempt_count=projection_evidence.auction_attempt_count,
        auction_revision_count=projection_evidence.auction_revision_count,
        canonical_fingerprint=projection_evidence.canonical_fingerprint,
    )


def _raise_stored_failure(checkpoint: FoundationCheckpoint) -> None:
    if checkpoint.failure_category == SOURCE_THROTTLED:
        raise SourceThrottledError(429)
    if checkpoint.failure_category == SOURCE_CONTRACT:
        raise SourceContractError("foundation previously failed the source contract")
    if checkpoint.failure_category == DATA_QUARANTINED:
        normalization = checkpoint.normalization
        if (
            checkpoint.observation is None
            or normalization is None
            or normalization.quarantine_reason is None
        ):
            raise FoundationIntegrityError(
                "stored quarantine failure metadata is incomplete"
            )
        raise DataQuarantinedError(
            checkpoint.observation.observation_id, normalization.quarantine_reason
        )
    if checkpoint.failure_category == "PROJECTION_CONTRACT":
        raise ProjectionContractError("foundation previously failed projection")
    raise FoundationIntegrityError("unsupported stored foundation failure")


def _positive_int(value: object, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise FoundationIntegrityError(f"{field} must be a positive integer")


def _nonnegative_int(value: object, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise FoundationIntegrityError(f"{field} must be a nonnegative integer")


def _sha256(value: object, field: str) -> None:
    if not isinstance(value, str) or _SHA256_PATTERN.fullmatch(value) is None:
        raise FoundationIntegrityError(f"{field} must be a lowercase SHA-256 digest")
