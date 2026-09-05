"""모듈 책임: core 투영이 저장소에 요구하는 port와, 봉인된 발행 구성원·발행 증거의 모양을 둔다.

여기에 구현이 없는 이유는 이 계약을 PostgreSQL 어댑터와 테스트 fake가 함께 지키기 때문이다.
"""

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


@dataclass(frozen=True, slots=True)
class PublishedProjectionEvidence:
    publication_id: UUID
    members_projected: int
    organization_count: int
    auction_attempt_count: int
    auction_revision_count: int
    canonical_fingerprint: str
    # 발행된 명단 행과 낙찰 판정의 수다. `auction.v1` 발행에서는 둘 다 0이며 그것은 "명단이 비었다"가
    # 아니라 v1 계약에 명단이라는 사실이 없다는 뜻이다.
    bid_submission_count: int = 0
    award_decision_count: int = 0


class CanonicalProjectionRepository(Protocol):
    def project_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime,
        projection_factory: ProjectionFactory,
    ) -> ProjectResult: ...

    def verify_published_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        projection_factory: ProjectionFactory,
    ) -> PublishedProjectionEvidence: ...
