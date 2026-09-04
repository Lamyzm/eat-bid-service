"""모듈 책임: 보존된 관측 목록을 같은 run 정체성으로 다시 정규화·검증·투영하며 재실행을 멱등하게 만든다."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from eatbid.core.repository import (
    CanonicalProjectionRepository,
    ProjectionContractError,
)
from eatbid.errors import SourceContractError
from eatbid.ingest.normalization_repository import NormalizationRepository
from eatbid.ingest.publication_repository import PublicationRepository
from eatbid.ingest.replay_repository import (
    ReplayRunRepository,
    ReplayRunState,
    canonical_replay_manifest,
    replay_manifest_fingerprint,
    validate_replay_start,
)
from eatbid.object_store import RawObjectStore
from eatbid.pipeline.normalize import DataQuarantinedError, normalize_observation
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.stages import validate_stage_timestamps
from eatbid.pipeline.validate import validate_run

DATA_QUARANTINED = "DATA_QUARANTINED"
SOURCE_CONTRACT = "SOURCE_CONTRACT"
PROJECTION_CONTRACT = "PROJECTION_CONTRACT"

__all__ = [
    "ReplayResult",
    "ReplayServices",
    "canonical_replay_manifest",
    "replay_manifest_fingerprint",
    "replay_observations",
]


@dataclass(frozen=True, slots=True)
class ReplayResult:
    run_id: UUID
    publication_id: UUID
    status: str
    canonical_fingerprint: str


@dataclass(frozen=True, slots=True)
class ReplayServices:
    replay_repository: ReplayRunRepository
    normalization_repository: NormalizationRepository
    publication_repository: PublicationRepository
    projection_repository: CanonicalProjectionRepository
    store: RawObjectStore


def replay_observations(
    *,
    run_id: UUID,
    publication_id: UUID,
    observation_ids: tuple[int, ...],
    build_sha: str,
    parser_version: str,
    started_at: datetime,
    normalized_at: datetime,
    validated_at: datetime,
    activated_at: datetime,
    services: ReplayServices,
) -> ReplayResult:
    manifest = validate_replay_start(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
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
    state = services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=manifest,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
    )
    _verify_loaded_identity(
        state,
        run_id=run_id,
        publication_id=publication_id,
        manifest=manifest,
        build_sha=build_sha,
        parser_version=parser_version,
    )
    if state.status == "failed":
        _raise_stored_failure(state)

    quarantined: DataQuarantinedError | None = None
    if state.status == "running":
        for observation_id in manifest:
            try:
                normalize_observation(
                    processing_run_id=run_id,
                    observation_id=observation_id,
                    parser_version=parser_version,
                    normalized_at=normalized_at,
                    store=services.store,
                    repository=services.normalization_repository,
                )
            except DataQuarantinedError as error:
                if quarantined is None:
                    quarantined = error
            except SourceContractError:
                # 검토되지 않은 parser version처럼 소스 계약이 막은 관측은 정규화 행을 남기지 않는다.
                # 여기서 바로 던지면 run과 publication이 running·pending으로 남아 실패가 ledger에
                # 보이지 않으므로, 완성도 검사가 run 단위로 판정하고 그 결과를 아래에서 다시 던진다.
                continue

        validation = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=validated_at,
            repository=services.publication_repository,
        )
        if validation.status == "failed":
            if quarantined is not None:
                raise quarantined
            raise SourceContractError("replay failed the source completeness contract")
        if validation.status != "validated":
            raise RuntimeError("replay validation returned an unsupported state")

    projected = project_publication(
        publication_id=publication_id,
        projector_version=build_sha,
        activated_at=activated_at,
        repository=services.projection_repository,
    )
    if projected.publication_id != publication_id:
        raise ProjectionContractError("projector returned a different publication")
    return ReplayResult(
        run_id=run_id,
        publication_id=publication_id,
        status="published",
        canonical_fingerprint=projected.canonical_fingerprint,
    )


def _raise_stored_failure(state: ReplayRunState) -> None:
    if state.failure_category == DATA_QUARANTINED:
        if state.failure_observation_id is None or state.failure_reason is None:
            raise RuntimeError("stored quarantine failure metadata is incomplete")
        raise DataQuarantinedError(state.failure_observation_id, state.failure_reason)
    if state.failure_category == SOURCE_CONTRACT:
        raise SourceContractError("replay previously failed the source contract")
    if state.failure_category == PROJECTION_CONTRACT:
        raise ProjectionContractError("replay previously failed projection")
    raise RuntimeError("replay has an unsupported stored failure category")


def _verify_loaded_identity(
    state: ReplayRunState,
    *,
    run_id: UUID,
    publication_id: UUID,
    manifest: tuple[int, ...],
    build_sha: str,
    parser_version: str,
) -> None:
    if (
        state.run_id != run_id
        or state.publication_id != publication_id
        or state.observation_ids != manifest
        or state.build_sha != build_sha
        or state.parser_version != parser_version
    ):
        raise RuntimeError("replay repository returned a different frozen identity")
