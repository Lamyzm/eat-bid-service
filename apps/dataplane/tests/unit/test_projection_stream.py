"""batch 스트리밍 투영이 발행 크기와 무관하게 batch 크기만큼만 메모리에 살려 두는지 확인한다.

PostgreSQL 없이 순수 흐름만 본다. 잠금·읽기·쓰기가 실제 DB에서 batch 경계를 넘는지는
`tests/integration/test_project_streaming.py`가 본다.
"""

from __future__ import annotations

import gc
import weakref
from collections.abc import Iterator, Sequence
from dataclasses import replace
from datetime import UTC, datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from eatbid.core.models import AuctionProjection
from eatbid.core.projection_models import AppliedProjectionCounts
from eatbid.core.projection_stream import (
    PROJECTION_BATCH_SIZE,
    MemberEvidence,
    batched_ids,
    project_member_batches,
)
from eatbid.core.repository import FrozenPublicationMember, ProjectionContractError
from eatbid.pipeline.project import build_projection

from .test_project import auction_payload, frozen_member

OBSERVED_AT = datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)


class TrackedPayload(dict[str, object]):
    """weakref로 생존을 셀 수 있는 payload. 순수 dict는 weakref를 지원하지 않는다."""


class AliveSet:
    """id로 묶은 weakref 집합. dict 하위 클래스는 hash가 없어 `WeakSet`에 들어가지 못한다."""

    def __init__(self) -> None:
        self._refs: weakref.WeakValueDictionary[int, TrackedPayload] = (
            weakref.WeakValueDictionary()
        )

    def add(self, payload: TrackedPayload) -> None:
        self._refs[id(payload)] = payload

    def __len__(self) -> int:
        return len(self._refs)


def _member(index: int, alive: AliveSet) -> MemberEvidence:
    payload = TrackedPayload(auction_payload())
    identity = payload["identity"]
    assert isinstance(identity, dict)
    identity["externalBidId"] = f"bid-{index}"
    alive.add(payload)
    return MemberEvidence(
        member=frozen_member(
            normalized_record_id=index + 1,
            observation_id=index + 1,
            source_entity_id=f"bid-{index}",
            normalized_payload=payload,
        ),
        observed_at=OBSERVED_AT,
    )


def _streamed_batches(
    count: int,
    batch_size: int,
    *,
    alive_payloads: AliveSet,
) -> Iterator[tuple[MemberEvidence, ...]]:
    """DB adapter처럼 batch를 요청받을 때마다 만든다. 미리 전부 만들면 이 테스트가 재는 것이 없다."""
    for start in range(0, count, batch_size):
        yield tuple(
            _member(index, alive_payloads)
            for index in range(start, min(start + batch_size, count))
        )


def _verify(member: FrozenPublicationMember, projection: AuctionProjection) -> None:
    assert projection.normalized_record_id == member.normalized_record_id


def test_상주_구성원과_투영은_발행_크기가_아니라_batch_크기를_넘지_않는다() -> None:
    """왜: 16,410건 발행에서 구성원 전체를 올렸다가 노드 OOM으로 죽었다(EAT-94). 구성원 payload와
    투영의 source payload를 weakref로 세어, 어느 batch를 쓰는 순간에도 살아 있는 수가 batch 크기
    이하임을 본다. 마지막 batch가 짧아도 앞 batch가 남아 있지 않아야 한다."""
    total, batch_size = 1_003, 100
    alive_payloads: AliveSet = AliveSet()
    alive_projections: AliveSet = AliveSet()
    peak_payloads = 0
    peak_projections = 0
    applied_order: list[str] = []

    def factory(member: FrozenPublicationMember) -> AuctionProjection:
        projection = build_projection(member)
        tracked = TrackedPayload(projection.source_payload)
        alive_projections.add(tracked)
        return replace(projection, source_payload=tracked)

    def apply(
        projection: AuctionProjection, observed_at: datetime
    ) -> AppliedProjectionCounts:
        nonlocal peak_payloads, peak_projections
        assert observed_at == OBSERVED_AT
        # batch의 첫 건에서만 수집한다. 앞 batch가 남아 있다면 이 시점에 가장 크게 보이고, 매 건마다
        # 수집하면 이 테스트가 투영 자체보다 오래 걸린다.
        if len(applied_order) % batch_size == 0:
            gc.collect()
        peak_payloads = max(peak_payloads, len(alive_payloads))
        peak_projections = max(peak_projections, len(alive_projections))
        applied_order.append(projection.external_bid_id)
        return AppliedProjectionCounts(auction_revisions=1)

    result = project_member_batches(
        _streamed_batches(total, batch_size, alive_payloads=alive_payloads),
        projection_factory=factory,
        verify_output=_verify,
        apply=apply,
    )

    assert result.members_projected == total
    assert result.applied.auction_revisions == total
    assert applied_order == [f"bid-{index}" for index in range(total)]
    assert 0 < peak_payloads <= batch_size
    assert 0 < peak_projections <= batch_size
    gc.collect()
    assert len(alive_payloads) == 0
    assert len(alive_projections) == 0


@settings(max_examples=40, deadline=None)
@given(
    count=st.integers(min_value=0, max_value=60),
    batch_size=st.integers(min_value=1, max_value=25),
)
def test_batch로_나눠도_지문과_건수는_한_번에_처리한_것과_같다(
    count: int, batch_size: int
) -> None:
    """왜: 지문은 발행을 봉인하는 값이라 batch 경계나 batch 크기에 흔들리면 같은 발행이 재실행마다
    다른 발행이 된다."""
    unused: AliveSet = AliveSet()
    members = tuple(_member(index, unused) for index in range(count))

    def apply(
        _projection: AuctionProjection, _observed_at: datetime
    ) -> AppliedProjectionCounts:
        return AppliedProjectionCounts(auction_attempts=1)

    whole = project_member_batches(
        [members] if members else [],
        projection_factory=build_projection,
        verify_output=_verify,
        apply=apply,
    )
    batched = project_member_batches(
        (members[start : start + batch_size] for start in range(0, count, batch_size)),
        projection_factory=build_projection,
        verify_output=_verify,
        apply=apply,
    )

    assert batched.canonical_fingerprint == whole.canonical_fingerprint
    assert batched.members_projected == whole.members_projected == count
    assert batched.applied == whole.applied


def test_뒤_batch의_계약_위반은_예외로_올라오고_그_뒤_구성원은_쓰지_않는다() -> None:
    """왜: 실패를 삼키고 계속 쓰면 호출자의 transaction rollback이 부분 발행을 막을 기회를 잃는다."""
    unused: AliveSet = AliveSet()
    members = tuple(_member(index, unused) for index in range(7))
    broken = replace(
        members[4], member=replace(members[4].member, source_entity_id="different")
    )
    batches: Sequence[tuple[MemberEvidence, ...]] = (
        members[0:3],
        (members[3], broken, members[5]),
        members[6:7],
    )
    written: list[str] = []

    def apply(
        projection: AuctionProjection, _observed_at: datetime
    ) -> AppliedProjectionCounts:
        written.append(projection.external_bid_id)
        return AppliedProjectionCounts()

    with pytest.raises(ProjectionContractError, match="external ID"):
        project_member_batches(
            batches,
            projection_factory=build_projection,
            verify_output=_verify,
            apply=apply,
        )

    # 첫 batch는 이미 썼고(호출자가 되돌린다) 깨진 batch는 한 건도 쓰지 않았다 — batch 안에서는
    # 전부 검증한 뒤에 쓰기 때문이다.
    assert written == ["bid-0", "bid-1", "bid-2"]


def test_batch_id_자르기는_manifest_순서를_지키고_마지막만_짧다() -> None:
    ids = tuple(range(10, 22))

    assert list(batched_ids(ids, 5)) == [
        (10, 11, 12, 13, 14),
        (15, 16, 17, 18, 19),
        (20, 21),
    ]
    assert list(batched_ids((), 5)) == []
    assert list(batched_ids(ids, 100)) == [ids]
    with pytest.raises(ValueError, match="positive"):
        list(batched_ids(ids, 0))


def test_기본_batch_크기는_통과한_창보다_작고_양수다() -> None:
    """왜: 4,023건 창은 한도 없이도 통과했고 16,410건 창은 죽었다(EAT-94). 기본값은 그 통과한 크기
    아래여야 상주 메모리가 확인된 범위에 머문다."""
    assert 0 < PROJECTION_BATCH_SIZE <= 4_023
