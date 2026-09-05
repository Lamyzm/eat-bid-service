"""모듈 책임: 공고 한 건의 core 투영 값과 발행 결과 누계, 그리고 발행물을 봉인하는 canonical
투영 지문의 계산을 소유한다.

지문이 여기 있는 이유는 그 정의가 투영 값의 어떤 필드를 쓰는지와 한 몸이기 때문이다. 명단 grain의
투영 값은 `projection_models.py`가 따로 갖는다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
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
    source_status: str
    title: str
    announced_at: datetime | None
    deadline_at: datetime | None
    opened_at: datetime | None
    base_amount: Decimal | None
    planned_amount: Decimal | None
    currency: str
    source_payload: dict[str, object]


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
    # 아래 다섯은 `auction.v2` 발행에서만 0이 아니다. v1 record에는 명단 블록이 없으므로 기본값 0은
    # "명단이 비었다"가 아니라 "이 계약에는 명단이라는 사실이 없다"는 뜻이다.
    supplier_parties_inserted: int = 0
    supplier_accounts_inserted: int = 0
    bid_submissions_inserted: int = 0
    award_decisions_inserted: int = 0
    attempt_links_inserted: int = 0


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
