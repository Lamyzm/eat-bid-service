"""모듈 책임: 봉인된 발행 구성원을 batch 단위로 투영·검증·기록해 상주 메모리가 발행 크기가 아니라
batch 크기에 비례하게 만드는 흐름을 소유한다.

PostgreSQL에서 batch를 어떻게 잠그고 읽는지는 `postgres_repository`가, 행을 어떻게 쓰는지는
`postgres_projection_writer`가 갖는다. 여기는 그 둘 사이에서 "한 번에 몇 건을 살려 두는가"와
"batch로 나눠도 지문·건수가 통째로 처리한 것과 같은가"만 결정한다.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime

from eatbid.core.models import (
    AuctionProjection,
    ProjectionFingerprintItem,
    canonical_projection_fingerprint,
)
from eatbid.core.projection_models import AppliedProjectionCounts
from eatbid.core.projection_validation import validate_projection
from eatbid.core.repository import FrozenPublicationMember, ProjectionFactory

# 한 번에 메모리에 올리는 발행 구성원 수다. 2026-09-07 백필 창 `20260616..20260630`의 project pod는
# 구성원 16,410건의 정규화 payload와 투영 객체를 전부 올렸다가 노드(allocatable 약 12 GiB) 전체를
# 잡아먹고 SystemOOM으로 죽었다(EAT-94). 4,023건 창은 같은 경로로 통과했으므로 500이면 그 8분의 1이고,
# manifest가 아니라 코드가 갖는 이유는 chunk 크기와 같다 — workflow 인자에 숫자를 두면 두 번째 설정
# 원천이 된다.
PROJECTION_BATCH_SIZE = 500


@dataclass(frozen=True, slots=True)
class MemberEvidence:
    """잠근 구성원 하나와 그 raw 관측 시각. 관측 시각은 code label 증거의 `observed_at`이 된다."""

    member: FrozenPublicationMember
    observed_at: datetime


ProjectionApplier = Callable[[AuctionProjection, datetime], AppliedProjectionCounts]
FactoryOutputVerifier = Callable[[FrozenPublicationMember, AuctionProjection], None]


@dataclass(frozen=True, slots=True)
class StreamedProjection:
    members_projected: int
    applied: AppliedProjectionCounts
    canonical_fingerprint: str


def batched_ids(ids: Sequence[int], batch_size: int) -> Iterator[tuple[int, ...]]:
    """manifest 순서를 그대로 유지한 채 id를 batch로 자른다. 마지막 batch만 짧을 수 있다."""
    if batch_size < 1:
        raise ValueError("projection batch size must be positive")
    for start in range(0, len(ids), batch_size):
        yield tuple(ids[start : start + batch_size])


def project_member_batches(
    batches: Iterable[Sequence[MemberEvidence]],
    *,
    projection_factory: ProjectionFactory,
    verify_output: FactoryOutputVerifier,
    apply: ProjectionApplier,
) -> StreamedProjection:
    """batch마다 투영을 만들고 검증한 뒤 바로 쓰며, 다음 batch로 넘어가면 앞 batch를 놓는다.

    batch 하나 안에서는 전부 만들어 검증한 뒤에 쓴다 — 계약 위반을 SQL보다 먼저 잡아 어느 행이
    문제였는지를 남기기 위해서다(`projection_validation` 참조). batch 사이에서는 그 순서를 지키지
    않는다. 뒤 batch의 계약 위반은 앞 batch의 write 뒤에 드러나지만 호출자가 한 transaction을 통째로
    되돌리므로 공개되는 것은 없다.

    지문 항목만 발행 전체 크기로 남는다. 지문은 정렬한 tuple 목록의 digest라 마지막까지 모아야 하며,
    항목 하나가 짧은 문자열 다섯 개라 payload와 달리 발행 크기에 비례해도 문제가 되지 않는다.
    """
    items: list[ProjectionFingerprintItem] = []
    applied = AppliedProjectionCounts()
    for batch in batches:
        projections = [projection_factory(item.member) for item in batch]
        for item, projection in zip(batch, projections, strict=True):
            validate_projection(projection)
            verify_output(item.member, projection)
        for item, projection in zip(batch, projections, strict=True):
            applied += apply(projection, item.observed_at)
            items.append(_fingerprint_item(projection))
    return StreamedProjection(
        members_projected=len(items),
        applied=applied,
        canonical_fingerprint=canonical_projection_fingerprint(items),
    )


def _fingerprint_item(projection: AuctionProjection) -> ProjectionFingerprintItem:
    return ProjectionFingerprintItem(
        source_system=projection.source_system,
        external_bid_id=projection.external_bid_id,
        raw_content_sha256=projection.raw_content_sha256,
        parser_version=projection.parser_version,
        normalized_payload_sha256=projection.normalized_payload_sha256,
    )
