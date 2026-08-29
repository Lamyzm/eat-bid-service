from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from uuid import UUID

from pydantic import ValidationError

from eatbid.core.models import (
    AuctionProjection,
    ExternalCodeRef,
    ProjectionFingerprintItem,
    ProjectResult,
    canonical_projection_fingerprint,
)
from eatbid.core.repository import (
    CanonicalProjectionRepository,
    FrozenPublicationMember,
    ProjectionContractError,
)
from eatbid.source.eat.models import NormalizedAuction

__all__ = [
    "ProjectionFingerprintItem",
    "build_eat_auction_projection",
    "canonical_projection_fingerprint",
    "project_publication",
]

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def build_eat_auction_projection(
    member: FrozenPublicationMember,
) -> AuctionProjection:
    if member.source_system != "eat":
        raise ProjectionContractError("projection source must be eat")
    if member.endpoint != "bid-detail":
        raise ProjectionContractError("projection endpoint must be bid-detail")
    if member.record_type != "auction":
        raise ProjectionContractError("projection record type must be auction")
    if member.parser_version != member.run_parser_version:
        raise ProjectionContractError("projection parser version differs from run")
    if (
        len(member.raw_content_sha256) != 64
        or any(character not in "0123456789abcdef" for character in member.raw_content_sha256)
    ):
        raise ProjectionContractError("projection raw content hash is invalid")

    try:
        canonical_payload = json.dumps(
            member.normalized_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        record = NormalizedAuction.model_validate_json(canonical_payload, strict=True)
    except (TypeError, ValueError, ValidationError) as error:
        raise ProjectionContractError("projection normalized payload is invalid") from error
    if record.external_bid_id != member.source_entity_id:
        raise ProjectionContractError("projection external ID differs from lineage")
    if len(set(record.eligibility_codes)) != len(record.eligibility_codes):
        raise ProjectionContractError("projection has duplicate eligibility codes")

    code_refs: list[ExternalCodeRef] = []
    if record.sido_code is not None:
        code_refs.append(
            ExternalCodeRef(
                namespace="eat:auction-location-sido",
                code=record.sido_code,
                role="location_sido",
            )
        )
    if record.sigungu_code is not None:
        code_refs.append(
            ExternalCodeRef(
                namespace="eat:auction-location-sigungu",
                code=record.sigungu_code,
                role="location_sigungu",
            )
        )
    code_refs.extend(
        ExternalCodeRef(
            namespace="eat:eligibility-area",
            code=code,
            role="eligibility_area",
        )
        for code in record.eligibility_codes
    )

    return AuctionProjection(
        normalized_record_id=member.normalized_record_id,
        observation_id=member.observation_id,
        source_system=member.source_system,
        endpoint=member.endpoint,
        parser_version=member.parser_version,
        raw_content_sha256=member.raw_content_sha256,
        normalized_payload_sha256=hashlib.sha256(canonical_payload).hexdigest(),
        external_bid_id=record.external_bid_id,
        display_bid_no=record.display_bid_no,
        organization_code=record.organization_code,
        organization_label=record.organization_name,
        code_refs=tuple(code_refs),
        source_status=record.source_status,
        title=record.title,
        announced_at=record.announced_at,
        deadline_at=record.deadline_at,
        opened_at=record.opened_at,
        base_amount=record.base_amount,
        planned_amount=record.planned_amount,
        currency=record.currency,
        source_payload=record.model_dump(mode="json"),
    )


def project_publication(
    *,
    publication_id: UUID,
    projector_version: str,
    activated_at: datetime,
    repository: CanonicalProjectionRepository,
) -> ProjectResult:
    if not isinstance(publication_id, UUID):
        raise TypeError("publication_id must be a UUID")
    if _SHA256_PATTERN.fullmatch(projector_version) is None:
        raise ValueError("projector_version must be a lowercase SHA-256 digest")
    if activated_at.utcoffset() is None:
        raise ValueError("activated_at must be timezone-aware")
    return repository.project_publication(
        publication_id=publication_id,
        projector_version=projector_version,
        activated_at=activated_at,
        projection_factory=build_eat_auction_projection,
    )
