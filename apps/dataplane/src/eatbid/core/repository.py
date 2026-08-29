from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from eatbid.core.models import AuctionProjection, ProjectResult


class ProjectionContractError(RuntimeError):
    """Frozen publication input conflicts with the canonical projection contract."""


class ProjectionTransactionScopeError(RuntimeError):
    """Projection requires a repository-owned, idle database transaction."""


@dataclass(frozen=True, slots=True)
class FrozenPublicationMember:
    normalized_record_id: int
    observation_id: int
    source_system: str
    endpoint: str
    run_parser_version: str
    record_type: str
    source_entity_id: str
    normalized_payload: Mapping[str, object]
    parser_version: str
    raw_content_sha256: str


class ProjectionFactory(Protocol):
    def __call__(self, member: FrozenPublicationMember) -> AuctionProjection: ...


class CanonicalProjectionRepository(Protocol):
    def project_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime,
        projection_factory: ProjectionFactory,
    ) -> ProjectResult: ...
