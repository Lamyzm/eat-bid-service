from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from eatbid.core.repository import CanonicalProjectionRepository
from eatbid.errors import SourceContractError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.normalization_repository import NormalizationRepository
from eatbid.ingest.publication_repository import PublicationRepository
from eatbid.ingest.repository import CaptureRunMode, IngestRepository
from eatbid.object_store import RawObjectStore
from eatbid.pipeline.capture import capture
from eatbid.pipeline.normalize import normalize_observation
from eatbid.pipeline.project import project_publication
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceClient


@dataclass(frozen=True, slots=True)
class FoundationServices:
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
    services.ingest_repository.start_run(
        run_id=run_id,
        mode=mode,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        expected_count=expected_count,
    )
    planned = services.ingest_repository.plan_request_unit(
        run_id=run_id,
        source=source,
        endpoint=endpoint,
        params=request_params,
        expected_count=expected_count,
    )
    observation = capture(
        CaptureRequest(
            request_unit_id=planned.request_unit_id,
            run_id=planned.run_id,
            source=planned.source,
            endpoint=planned.endpoint,
            params=planned.params,
        ),
        services.raw_store,
        services.ingest_repository,
        services.source_client,
    )
    normalize_observation(
        processing_run_id=run_id,
        observation_id=observation.observation_id,
        parser_version=parser_version,
        normalized_at=normalized_at,
        store=services.raw_store,
        repository=services.normalization_repository,
    )
    validation = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=validated_at,
        repository=services.publication_repository,
    )
    if validation.status != "validated":
        raise SourceContractError("foundation run failed the source completeness contract")
    projected = project_publication(
        publication_id=publication_id,
        projector_version=build_sha,
        activated_at=activated_at,
        repository=services.projection_repository,
    )
    return FoundationResult(
        capture_run_id=run_id,
        publication_id=publication_id,
        request_unit_id=planned.request_unit_id,
        observation_ids=(observation.observation_id,),
        raw_content_sha256=observation.content_sha256,
        raw_object_key=observation.object_key,
        raw_blob_count=1,
        observation_count=1,
        publication_status="published",
        organization_count=projected.organizations_inserted,
        auction_attempt_count=projected.auction_attempts_inserted,
        auction_revision_count=projected.auction_revisions_inserted,
        canonical_fingerprint=projected.canonical_fingerprint,
    )
