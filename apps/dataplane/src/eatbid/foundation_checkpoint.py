"""모듈 책임: 저장소가 돌려준 foundation checkpoint가 요청한 정체성과 status별 불변식을 지켰는지 판독한다."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationIntegrityError,
    FoundationNormalizationCheckpoint,
    FoundationObservationCheckpoint,
    FoundationPublicationCheckpoint,
    FoundationPublishedEvidence,
    FoundationRequestCheckpoint,
)
from eatbid.foundation_values import (
    _aware_datetime,
    _http_status,
    _nonempty_string,
    _nonnegative_int,
    _positive_int,
    _sha256,
    _string_mapping,
)
from eatbid.foundation_verification import (
    _verify_evidence,
    _verify_normalization_lineage,
)
from eatbid.ingest.repository import CaptureRunMode, request_params_sha256
from eatbid.pipeline.capture import SOURCE_CONTRACT, SOURCE_THROTTLED


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
    _verify_checkpoint_shapes(checkpoint)
    request, publication = checkpoint.request, checkpoint.publication
    request_params = _string_mapping(request.params, "request params")
    observation_params = (
        _string_mapping(checkpoint.observation.params, "observation params")
        if checkpoint.observation is not None
        else None
    )
    _verify_checkpoint_scalars(checkpoint)
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
        or request_params != params
        or request.request_params_hash != request_params_sha256(params)
        or request.expected_count != expected_count
        or publication.run_id != run_id
        or publication.publication_id != publication_id
        or publication.expected_count != expected_count
    ):
        raise FoundationIntegrityError(
            "checkpoint returned a different frozen identity"
        )
    if checkpoint.observation is not None:
        observation = checkpoint.observation
        if (
            observation.run_id != run_id
            or observation.request_unit_id != request.request_unit_id
            or observation.source != source
            or observation.endpoint != endpoint
            or observation_params != params
        ):
            raise FoundationIntegrityError("observation differs from frozen request")
    observed_count = int(checkpoint.observation is not None)
    if (
        request.observed_count != observed_count
        or checkpoint.captured_count != observed_count
    ):
        raise FoundationIntegrityError("checkpoint capture counts are inconsistent")
    if checkpoint.status in {"validated", "published"}:
        _verify_normalization_lineage(checkpoint)
    if checkpoint.status == "running":
        expected_request_status = "planned" if observed_count == 0 else "captured"
        if (
            request.status != expected_request_status
            or checkpoint.failure_category is not None
            or checkpoint.ended_at is not None
            or publication.status != "pending"
            or publication.normalized_count != 0
            or publication.published_count != 0
            or publication.member_ids
            or publication.canonical_fingerprint is not None
            or publication.projector_version is not None
        ):
            raise FoundationIntegrityError("running checkpoint status is inconsistent")
    elif checkpoint.status == "validated":
        if (
            request.status != "captured"
            or checkpoint.failure_category is not None
            or checkpoint.ended_at is not None
            or publication.status != "validated"
            or publication.canonical_fingerprint is not None
            or publication.projector_version is not None
        ):
            raise FoundationIntegrityError(
                "validated checkpoint status is inconsistent"
            )
    elif checkpoint.status == "published":
        if (
            request.status != "captured"
            or checkpoint.failure_category is not None
            or checkpoint.ended_at is None
            or publication.status != "published"
            or publication.projector_version != build_sha
        ):
            raise FoundationIntegrityError(
                "published checkpoint status is inconsistent"
            )
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


def _verify_checkpoint_shapes(checkpoint: FoundationCheckpoint) -> None:
    if not isinstance(checkpoint.request, FoundationRequestCheckpoint):
        raise FoundationIntegrityError("checkpoint lacks a typed request")
    if not isinstance(checkpoint.publication, FoundationPublicationCheckpoint):
        raise FoundationIntegrityError("checkpoint lacks a typed publication")
    if checkpoint.observation is not None and not isinstance(
        checkpoint.observation, FoundationObservationCheckpoint
    ):
        raise FoundationIntegrityError("checkpoint returned an untyped observation")
    if checkpoint.normalization is not None and not isinstance(
        checkpoint.normalization, FoundationNormalizationCheckpoint
    ):
        raise FoundationIntegrityError("checkpoint returned an untyped normalization")
    if checkpoint.evidence is not None and not isinstance(
        checkpoint.evidence, FoundationPublishedEvidence
    ):
        raise FoundationIntegrityError("checkpoint returned untyped evidence")


def _verify_checkpoint_scalars(checkpoint: FoundationCheckpoint) -> None:
    request = checkpoint.request
    publication = checkpoint.publication
    if not isinstance(checkpoint.status, str):
        raise FoundationIntegrityError("checkpoint status must be a string")
    if checkpoint.failure_category is not None and not isinstance(
        checkpoint.failure_category, str
    ):
        raise FoundationIntegrityError("failure_category must be a string")
    _aware_datetime(checkpoint.started_at, "checkpoint started_at")
    if checkpoint.ended_at is not None:
        _aware_datetime(checkpoint.ended_at, "checkpoint ended_at")
        if checkpoint.ended_at < checkpoint.started_at:
            raise FoundationIntegrityError("checkpoint ended_at precedes started_at")
    _nonnegative_int(checkpoint.expected_count, "checkpoint expected_count")
    _nonnegative_int(checkpoint.captured_count, "captured_count")
    _nonnegative_int(checkpoint.published_count, "published_count")

    _positive_int(request.request_unit_id, "request_unit_id")
    _nonnegative_int(request.expected_count, "request expected_count")
    _nonnegative_int(request.observed_count, "request observed_count")
    _sha256(request.request_params_hash, "request_params_hash")

    _nonnegative_int(publication.expected_count, "publication expected_count")
    _nonnegative_int(publication.normalized_count, "publication normalized_count")
    _nonnegative_int(publication.published_count, "publication published_count")
    if not isinstance(publication.member_ids, tuple):
        raise FoundationIntegrityError("publication member_ids must be a tuple")
    for member_id in publication.member_ids:
        _positive_int(member_id, "publication member_id")
    if publication.canonical_fingerprint is not None:
        _sha256(
            publication.canonical_fingerprint,
            "publication canonical_fingerprint",
        )
    if publication.projector_version is not None:
        _nonempty_string(publication.projector_version, "publication projector_version")

    observation = checkpoint.observation
    if observation is not None:
        _positive_int(observation.observation_id, "observation_id")
        _positive_int(observation.request_unit_id, "observation request_unit_id")
        _aware_datetime(observation.fetched_at, "observation fetched_at")
        if observation.fetched_at < checkpoint.started_at:
            raise FoundationIntegrityError(
                "observation fetched_at precedes checkpoint started_at"
            )
        _http_status(observation.http_status)
        _sha256(observation.content_sha256, "observation content_sha256")
        _nonempty_string(observation.object_key, "observation object_key")
        _nonnegative_int(observation.byte_length, "observation byte_length")

    normalization = checkpoint.normalization
    if normalization is not None:
        _positive_int(
            normalization.normalization_attempt_id,
            "normalization_attempt_id",
        )
        _positive_int(normalization.observation_id, "normalization observation_id")
        _nonempty_string(normalization.parser_version, "normalization parser_version")
        _nonempty_string(normalization.status, "normalization status")
        if normalization.normalized_record_id is not None:
            _positive_int(normalization.normalized_record_id, "normalized_record_id")
        if normalization.schema_fingerprint is not None:
            _sha256(normalization.schema_fingerprint, "schema_fingerprint")

