"""모듈 책임: 봉인된 발행 구성원을 core 투영으로 옮기며 lineage와 발행 가능한 record type을 지킨다."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import ValidationError

from eatbid.core.models import (
    AuctionProjection,
    ExternalCodeRef,
    ProjectionFingerprintItem,
    ProjectResult,
    canonical_projection_fingerprint,
)
from eatbid.core.record_types import is_projectable_record_type
from eatbid.core.repository import (
    CanonicalProjectionRepository,
    FrozenPublicationMember,
    ProjectionContractError,
    PublishedProjectionEvidence,
)
from eatbid.generated.ingestion_v1 import EatbidIngestionAuctionV1, InstantText, Money

__all__ = [
    "ProjectionFingerprintItem",
    "build_eat_auction_projection",
    "canonical_projection_fingerprint",
    "parse_canonical_normalized_auction",
    "project_publication",
    "verify_published_publication",
]

_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _require_projectable(record_type: str) -> None:
    if not is_projectable_record_type(record_type):
        raise ProjectionContractError(
            f"normalized record type is not projectable yet [record_type={record_type}]"
        )


def parse_canonical_normalized_auction(value: object) -> EatbidIngestionAuctionV1:
    """Parse the canonical normalized-auction bytes used by projection."""
    if not isinstance(value, bytes) or not value:
        raise ProjectionContractError(
            "projection normalized payload must be non-empty canonical JSON bytes"
        )
    try:
        decoded = json.loads(value)
        if not isinstance(decoded, dict):
            raise TypeError("normalized payload must be a JSON object")
        record = EatbidIngestionAuctionV1.model_validate_json(value, strict=True)
        canonical_payload = json.dumps(
            record.model_dump(mode="json", by_alias=True),
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        if canonical_payload != value:
            raise ValueError("normalized payload is not canonical JSON")
        return record
    except (TypeError, ValueError, ValidationError) as error:
        raise ProjectionContractError(
            "projection normalized payload is invalid"
        ) from error


def build_eat_auction_projection(
    member: FrozenPublicationMember,
) -> AuctionProjection:
    if member.source_system != "eat":
        raise ProjectionContractError("projection source must be eat")
    if member.endpoint != "bid-detail":
        raise ProjectionContractError("projection endpoint must be bid-detail")
    _require_projectable(member.record_type)
    if member.parser_version != member.run_parser_version:
        raise ProjectionContractError("projection parser version differs from run")
    if len(member.raw_content_sha256) != 64 or any(
        character not in "0123456789abcdef" for character in member.raw_content_sha256
    ):
        raise ProjectionContractError("projection raw content hash is invalid")

    try:
        canonical_payload = json.dumps(
            member.normalized_payload,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    except (TypeError, ValueError, ValidationError) as error:
        raise ProjectionContractError(
            "projection normalized payload is invalid"
        ) from error
    record = parse_canonical_normalized_auction(canonical_payload)
    if record.identity.external_bid_id != member.source_entity_id:
        raise ProjectionContractError("projection external ID differs from lineage")
    eligibility_codes = tuple(code.root for code in record.location.eligibility_codes)
    if len(set(eligibility_codes)) != len(eligibility_codes):
        raise ProjectionContractError("projection has duplicate eligibility codes")

    code_refs: list[ExternalCodeRef] = []
    if record.location.sido_code is not None:
        code_refs.append(
            ExternalCodeRef(
                namespace="eat:auction-location-sido",
                code=record.location.sido_code.root,
                role="location_sido",
            )
        )
    if record.location.sigungu_code is not None:
        code_refs.append(
            ExternalCodeRef(
                namespace="eat:auction-location-sigungu",
                code=record.location.sigungu_code.root,
                role="location_sigungu",
            )
        )
    code_refs.extend(
        ExternalCodeRef(
            namespace="eat:eligibility-area",
            code=code,
            role="eligibility_area",
        )
        for code in eligibility_codes
    )

    source_payload = record.model_dump(mode="json", by_alias=True)

    return AuctionProjection(
        normalized_record_id=member.normalized_record_id,
        observation_id=member.observation_id,
        source_system=member.source_system,
        endpoint=member.endpoint,
        parser_version=member.parser_version,
        raw_content_sha256=member.raw_content_sha256,
        normalized_payload_sha256=hashlib.sha256(canonical_payload).hexdigest(),
        external_bid_id=record.identity.external_bid_id,
        display_bid_no=(
            record.identity.display_bid_number.root
            if record.identity.display_bid_number is not None
            else None
        ),
        organization_code=record.buyer.organization_code,
        organization_label=record.buyer.organization_name,
        code_refs=tuple(code_refs),
        source_status=record.identity.status,
        title=record.identity.title,
        announced_at=_instant_datetime(record.schedule.announced_at),
        deadline_at=_instant_datetime(record.schedule.deadline_at),
        opened_at=_instant_datetime(record.schedule.opened_at),
        base_amount=_money_decimal(record.pricing.base_amount),
        planned_amount=_money_decimal(record.pricing.planned_amount),
        currency="KRW",
        source_payload=source_payload,
    )


def _instant_datetime(value: InstantText | None) -> datetime | None:
    return datetime.fromisoformat(value.root) if value is not None else None


def _money_decimal(value: Money | None) -> Decimal | None:
    return Decimal(value.amount) if value is not None else None


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


def verify_published_publication(
    *,
    publication_id: UUID,
    projector_version: str,
    repository: CanonicalProjectionRepository,
) -> PublishedProjectionEvidence:
    if not isinstance(publication_id, UUID):
        raise TypeError("publication_id must be a UUID")
    if _SHA256_PATTERN.fullmatch(projector_version) is None:
        raise ValueError("projector_version must be a lowercase SHA-256 digest")
    return repository.verify_published_publication(
        publication_id=publication_id,
        projector_version=projector_version,
        projection_factory=build_eat_auction_projection,
    )
