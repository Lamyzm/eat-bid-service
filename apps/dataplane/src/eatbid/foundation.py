"""모듈 책임: 공고 하나의 capture→normalize→validate→project를 checkpoint로 재개 가능하게 잇는다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import TypedDict
from uuid import UUID

from eatbid.core.repository import (
    CanonicalProjectionRepository,
    ProjectionContractError,
    PublishedProjectionEvidence,
)
from eatbid.errors import SourceContractError
from eatbid.foundation_checkpoint import _verify_checkpoint
from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationCheckpointRepository,
    FoundationIntegrityError,
)
from eatbid.foundation_verification import (
    _load_verified_projection_evidence,
    _verify_capture_result,
    _verify_evidence,
    _verify_normalization_result,
    _verify_project_result,
    _verify_validation_result,
)
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.normalization_repository import NormalizationRepository
from eatbid.ingest.publication_repository import PublicationRepository
from eatbid.ingest.replay_repository import validate_processing_start
from eatbid.ingest.repository import CaptureRunMode, IngestRepository
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
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.stages import validate_stage_timestamps
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceClient

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
    contract_failure: str | None = None
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
        except SourceContractError as error:
            # replay와 같은 이유다. 소스 계약이 막은 관측은 정규화 행 없이 남고, run 단위 판정은
            # 아래 완성도 검사가 내려 checkpoint에 실패로 기록한다. 사유를 들고 가지 않으면 그
            # checkpoint에는 "소스 계약 실패"만 남고 무엇이 막았는지는 사라진다.
            contract_failure = str(error)
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
            _raise_stored_failure(checkpoint, observed_reason=contract_failure)
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


def _raise_stored_failure(
    checkpoint: FoundationCheckpoint, *, observed_reason: str | None = None
) -> None:
    """저장된 실패를 다시 던진다. 같은 실행에서 관측한 사유가 있으면 함께 싣는다.

    checkpoint에는 실패 범주만 남고 사유는 남지 않는다. 재개된 실행은 사유를 알 수 없지만, 실패를
    처음 만든 실행은 알고 있으므로 그 문장을 버리지 않고 넘긴다.
    """
    if checkpoint.failure_category == SOURCE_THROTTLED:
        raise SourceThrottledError(429)
    if checkpoint.failure_category == SOURCE_CONTRACT:
        reason = "foundation previously failed the source contract"
        raise SourceContractError(
            reason if observed_reason is None else f"{reason}: {observed_reason}"
        )
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
