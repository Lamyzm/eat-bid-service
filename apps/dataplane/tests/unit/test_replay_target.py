"""재처리 대상 고르기가 무한 반복을 막는지 고정한다(EAT-274, EAT-296, EAT-294)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid5

import pytest

from eatbid.pipeline.replay_target import FailedPublication, select_replay_target

실행 = UUID(int=9)
기준시각 = datetime(2026, 9, 18, 0, 0, tzinfo=UTC)
지금이미지 = "b" * 40
옛이미지 = "a" * 40


def _후보(build_sha: str, window_start: str = "20241001") -> FailedPublication:
    return FailedPublication(
        source_release_id=UUID(int=1),
        publication_id=UUID(int=2),
        build_sha=build_sha,
        window_start=window_start,
        state="failed",
    )


멈춘시각 = 기준시각 - timedelta(hours=7)


def _멈춘_후보(
    build_sha: str,
    *,
    last_replay_started_at: datetime | None = None,
    window_start: str = "20260916",
) -> FailedPublication:
    return FailedPublication(
        source_release_id=UUID(int=3),
        publication_id=UUID(int=4),
        build_sha=build_sha,
        window_start=window_start,
        state="stalled",
        validated_at=멈춘시각,
        last_replay_started_at=last_replay_started_at,
    )


def test_지금_이미지가_실패시킨_창은_고르지_않는다() -> None:
    """왜: 같은 이미지로 다시 돌리면 같은 결과다. 이 규칙이 없으면 매 회차가 같은 창을 무한히
    다시 돌리며 발행 자물쇠를 붙잡는다."""
    후보들 = (_후보(지금이미지),)

    assert (
        select_replay_target(후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각)
        is None
    )


def test_다른_이미지가_실패시킨_창은_고른다() -> None:
    """왜: 파서나 계약이 바뀌었다는 뜻이고, 2026-09-17에 사람이 내린 판단도 이것이었다."""
    후보들 = (_후보(옛이미지),)

    대상 = select_replay_target(
        후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각
    )

    assert 대상 is not None
    assert 대상.window_start == "20241001"
    assert 대상.failed_publication_id == UUID(int=2)
    # 실패한 발행 id를 다시 쓰지 않고 run에서 결정적으로 파생한다.
    assert 대상.publication_id == uuid5(실행, "eatbid:replay-publication")
    assert 대상.publication_id != 대상.failed_publication_id
    # 네 시각은 오름차순이어야 하고 그 보장은 코드가 한다.
    assert 대상.started_at < 대상.normalized_at < 대상.validated_at < 대상.activated_at


def test_섞여_있으면_다시_시도할_가치가_있는_것만_고른다() -> None:
    후보들 = (_후보(지금이미지, "20250301"), _후보(옛이미지, "20241001"))

    대상 = select_replay_target(
        후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각
    )

    assert 대상 is not None
    assert 대상.window_start == "20241001"


def test_고를_것이_없으면_None이고_그것은_정상이다() -> None:
    assert (
        select_replay_target((), build_sha=지금이미지, run_id=실행, as_of=기준시각)
        is None
    )


def test_지금_이미지를_모르면_판단하지_않는다() -> None:
    """왜: build_sha가 비면 모든 후보가 "다르다"로 판정되어 같은 창을 무한히 돌린다."""
    with pytest.raises(ValueError, match="build_sha"):
        select_replay_target(
            (_후보(옛이미지),), build_sha="", run_id=실행, as_of=기준시각
        )


def test_검증_뒤_멈춘_창은_지금_이미지가_만들었어도_한_번은_고른다() -> None:
    """왜: 멈춤은 결정적인 결과가 아니라 교착 같은 중단이라 같은 이미지로 다시 돌려도 풀린다.
    2026-09 daily-reconcile 두 창이 core.organization 교착으로 validated에 남았는데, failed만 보던
    규칙은 그 창을 영원히 다시 시도하지 않았다(EAT-296)."""
    대상 = select_replay_target(
        (_멈춘_후보(지금이미지),), build_sha=지금이미지, run_id=실행, as_of=기준시각
    )

    assert 대상 is not None
    assert 대상.window_start == "20260916"
    assert 대상.failed_publication_id == UUID(int=4)
    assert 대상.publication_id == uuid5(실행, "eatbid:replay-publication")


def test_멈춘_창은_다른_이미지가_만들었어도_고른다() -> None:
    assert (
        select_replay_target(
            (_멈춘_후보(옛이미지),), build_sha=지금이미지, run_id=실행, as_of=기준시각
        )
        is not None
    )


def test_멈춘_뒤_replay가_이미_있었으면_같은_창을_다시_고르지_않는다() -> None:
    """왜: 그 replay도 멈췄다면 같은 멈춤을 무한히 되풀이할 뿐이다. 그때는 사람이 볼 차례이고 감시
    기대 stale-validated-publication이 계속 열려 있다."""
    후보들 = (
        _멈춘_후보(지금이미지, last_replay_started_at=멈춘시각 + timedelta(hours=1)),
    )

    assert (
        select_replay_target(후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각)
        is None
    )


def test_멈추기_전에_있던_replay는_멈춘_창을_막지_않는다() -> None:
    후보들 = (_멈춘_후보(지금이미지, last_replay_started_at=멈춘시각 - timedelta(days=1)),)

    assert (
        select_replay_target(후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각)
        is not None
    )


def test_검증_시각이_없는_멈춘_후보는_판단하지_않고_건너뛴다() -> None:
    """왜: validated인데 검증 시각이 없으면 ledger가 어긋난 것이다. 추측으로 고르지 않는다."""
    후보 = FailedPublication(
        source_release_id=UUID(int=3),
        publication_id=UUID(int=4),
        build_sha=지금이미지,
        window_start="20260916",
        state="stalled",
    )

    assert (
        select_replay_target((후보,), build_sha=지금이미지, run_id=실행, as_of=기준시각)
        is None
    )


def test_멈춘_창이_섞여_있어도_실패_창의_이미지_규칙은_그대로다() -> None:
    """같은 이미지가 실패시킨 창은 여전히 건너뛰고, 멈춘 창이 있으면 그것을 고른다."""
    후보들 = (
        _후보(지금이미지, "20260301"),
        _멈춘_후보(
            지금이미지,
            last_replay_started_at=멈춘시각 + timedelta(minutes=5),
            window_start="20260201",
        ),
        _멈춘_후보(지금이미지, window_start="20260101"),
    )

    대상 = select_replay_target(
        후보들, build_sha=지금이미지, run_id=실행, as_of=기준시각
    )

    assert 대상 is not None
    assert 대상.window_start == "20260101"


def _제외_후보(build_sha: str, window_start: str = "20241001") -> FailedPublication:
    return FailedPublication(
        source_release_id=UUID(int=5),
        publication_id=UUID(int=6),
        build_sha=build_sha,
        window_start=window_start,
        state="excluded",
    )


def test_해소_안_된_제외를_지금_이미지가_마지막으로_시도했으면_고르지_않는다() -> None:
    """왜: 같은 이미지로 다시 파싱하면 같은 격리가 나서 같은 제외가 적힌다(ADR 0061 결정 5). 발행은 성공한
    창이라 이 규칙이 없으면 매 회차 16,000건 창을 헛되이 다시 돈다."""
    assert (
        select_replay_target(
            (_제외_후보(지금이미지),), build_sha=지금이미지, run_id=실행, as_of=기준시각
        )
        is None
    )


def test_다른_이미지가_마지막으로_시도한_제외는_고른다() -> None:
    """왜: 계약을 고친 이미지가 배포됐다는 뜻이고, 그 재파싱이 제외 자리를 채울 수 있다."""
    대상 = select_replay_target(
        (_제외_후보(옛이미지),), build_sha=지금이미지, run_id=실행, as_of=기준시각
    )

    assert 대상 is not None
    assert 대상.source_release_id == UUID(int=5)
    assert 대상.failed_publication_id == UUID(int=6)
    assert 대상.publication_id == uuid5(실행, "eatbid:replay-publication")


def test_제외_후보가_섞여도_멈춘_창의_규칙은_그대로다() -> None:
    """EAT-296의 멈춤 규칙은 이미지를 보지 않는다. 앞에 선 제외 후보가 지금 이미지 것이면 건너뛰고 멈춘 창을 고른다."""
    대상 = select_replay_target(
        (_제외_후보(지금이미지, "20260920"), _멈춘_후보(지금이미지)),
        build_sha=지금이미지,
        run_id=실행,
        as_of=기준시각,
    )

    assert 대상 is not None
    assert 대상.source_release_id == UUID(int=3)
