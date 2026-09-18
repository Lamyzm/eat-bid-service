"""재처리 대상 고르기가 무한 반복을 막는지 고정한다(EAT-274)."""

from __future__ import annotations

from uuid import UUID, uuid5

import pytest

from eatbid.pipeline.replay_target import FailedPublication, select_replay_target

실행 = UUID(int=9)
지금이미지 = "b" * 40
옛이미지 = "a" * 40


def _후보(build_sha: str, window_start: str = "20241001") -> FailedPublication:
    return FailedPublication(
        source_release_id=UUID(int=1),
        publication_id=UUID(int=2),
        build_sha=build_sha,
        window_start=window_start,
    )


def test_지금_이미지가_실패시킨_창은_고르지_않는다() -> None:
    """왜: 같은 이미지로 다시 돌리면 같은 결과다. 이 규칙이 없으면 매 회차가 같은 창을 무한히
    다시 돌리며 발행 자물쇠를 붙잡는다."""
    후보들 = (_후보(지금이미지),)

    assert select_replay_target(후보들, build_sha=지금이미지, run_id=실행) is None


def test_다른_이미지가_실패시킨_창은_고른다() -> None:
    """왜: 파서나 계약이 바뀌었다는 뜻이고, 2026-09-17에 사람이 내린 판단도 이것이었다."""
    후보들 = (_후보(옛이미지),)

    대상 = select_replay_target(후보들, build_sha=지금이미지, run_id=실행)

    assert 대상 is not None
    assert 대상.window_start == "20241001"
    assert 대상.failed_publication_id == UUID(int=2)
    # 실패한 발행 id를 다시 쓰지 않고 run에서 결정적으로 파생한다.
    assert 대상.publication_id == uuid5(실행, "eatbid:replay-publication")
    assert 대상.publication_id != 대상.failed_publication_id


def test_섞여_있으면_다시_시도할_가치가_있는_것만_고른다() -> None:
    후보들 = (_후보(지금이미지, "20250301"), _후보(옛이미지, "20241001"))

    대상 = select_replay_target(후보들, build_sha=지금이미지, run_id=실행)

    assert 대상 is not None
    assert 대상.window_start == "20241001"


def test_고를_것이_없으면_None이고_그것은_정상이다() -> None:
    assert select_replay_target((), build_sha=지금이미지, run_id=실행) is None


def test_지금_이미지를_모르면_판단하지_않는다() -> None:
    """왜: build_sha가 비면 모든 후보가 "다르다"로 판정되어 같은 창을 무한히 돌린다."""
    with pytest.raises(ValueError, match="build_sha"):
        select_replay_target((_후보(옛이미지),), build_sha="", run_id=실행)
