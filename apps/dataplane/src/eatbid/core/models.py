from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from uuid import UUID


@dataclass(frozen=True, slots=True)
class ProjectionFingerprintItem:
    source_system: str
    external_bid_id: str
    raw_content_sha256: str
    parser_version: str
    normalized_payload_sha256: str


@dataclass(frozen=True, slots=True)
class ExternalCodeRef:
    namespace: str
    code: str
    role: str


@dataclass(frozen=True, slots=True)
class AuctionProjection:
    normalized_record_id: int
    observation_id: int
    source_system: str
    endpoint: str
    parser_version: str
    raw_content_sha256: str
    normalized_payload_sha256: str
    external_bid_id: str
    display_bid_no: str | None
    organization_code: str
    organization_label: str
    code_refs: tuple[ExternalCodeRef, ...]
    source_status: str | None = None
    title: str | None = None
    announced_at: datetime | None = None
    deadline_at: datetime | None = None
    opened_at: datetime | None = None
    base_amount: Decimal | None = None
    planned_amount: Decimal | None = None
    currency: str | None = None
    source_payload: Mapping[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ProjectResult:
    publication_id: UUID
    members_projected: int
    auction_attempts_inserted: int
    auction_revisions_inserted: int
    organizations_inserted: int
    code_values_inserted: int
    code_labels_inserted: int
    relationships_inserted: int
    canonical_fingerprint: str


def canonical_projection_fingerprint(
    items: Iterable[ProjectionFingerprintItem],
) -> str:
    members = sorted(
        (
            item.source_system,
            item.external_bid_id,
            item.raw_content_sha256,
            item.parser_version,
            item.normalized_payload_sha256,
        )
        for item in items
    )
    canonical = json.dumps(
        members,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()
