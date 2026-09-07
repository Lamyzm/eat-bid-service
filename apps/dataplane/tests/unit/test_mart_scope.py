"""`resolve_marts`가 발행마다 어느 mart를 다시 만들지 고르는 규칙을 DB 없이 확인한다."""

from __future__ import annotations

import pytest

from eatbid.mart.build_marts import CORE_MARTS, OPEN_AUCTION_MARTS, resolve_marts
from eatbid.mart.models import MART_NAMES
from eatbid.mart.repository import MartBuildContractError

SNAPSHOT = "open_auction_snapshot"


def test_core_mart와_스냅샷_mart를_합치면_mart_이름_전부다() -> None:
    assert tuple(CORE_MARTS) + tuple(OPEN_AUCTION_MARTS) == MART_NAMES


@pytest.mark.parametrize("run_mode", ["poll-open", "daily-reconcile"])
def test_열린_공고를_읽는_run의_auction_v2_발행은_core_둘과_스냅샷을_함께_만든다(
    run_mode: str,
) -> None:
    assert resolve_marts(
        requested=None, record_types=("auction.v2",), run_mode=run_mode
    ) == ("org_round_summary", "win_rate_distribution_monthly", SNAPSHOT)


def test_auction_v1_발행은_분포를_빼되_poll_open이면_스냅샷은_만든다() -> None:
    assert resolve_marts(
        requested=None, record_types=("auction.v1",), run_mode="poll-open"
    ) == ("org_round_summary", SNAPSHOT)


def test_record_type이_없는_poll_open_발행도_스냅샷을_만든다() -> None:
    # 목록만 실린 poll-open(상세 request unit 0건)이 이 모양이다. core 둘은 단서가 없어 다 만든다.
    assert (
        resolve_marts(requested=None, record_types=(), run_mode="poll-open") == MART_NAMES
    )


@pytest.mark.parametrize("run_mode", ["backfill", "replay", "reference", None, "unknown"])
def test_과거_창을_읽거나_모드를_모르는_run은_스냅샷을_만들지_않는다(
    run_mode: str | None,
) -> None:
    # 마감된 과거 공고로 스냅샷 활성 build를 물리면 오늘 화면이 빈다. core mart는 그대로 만든다.
    resolved = resolve_marts(
        requested=None, record_types=("auction.v2",), run_mode=run_mode
    )
    assert resolved == ("org_round_summary", "win_rate_distribution_monthly")
    assert not set(OPEN_AUCTION_MARTS) & set(resolved)


def test_모르는_record_type은_조용히_무시하지_않고_core_둘_다_만든다() -> None:
    assert resolve_marts(
        requested=None, record_types=("auction.v9",), run_mode="backfill"
    ) == CORE_MARTS
    assert (
        resolve_marts(requested=None, record_types=("auction.v9",), run_mode="poll-open")
        == MART_NAMES
    )


def test_같은_record_type이_겹쳐도_mart는_한_번씩만_고른다() -> None:
    assert resolve_marts(
        requested=None,
        record_types=("auction.v2", "auction.v1", "auction.v2"),
        run_mode="daily-reconcile",
    ) == ("org_round_summary", "win_rate_distribution_monthly", SNAPSHOT)


def test_mart_이름을_직접_주면_run_mode와_무관하게_그대로_쓴다() -> None:
    assert resolve_marts(
        requested=[SNAPSHOT], record_types=("auction.v2",), run_mode="backfill"
    ) == (SNAPSHOT,)
    assert resolve_marts(
        requested=["org_round_summary"], record_types=(), run_mode="poll-open"
    ) == ("org_round_summary",)
    with pytest.raises(MartBuildContractError):
        resolve_marts(
            requested=["supplier_monthly_record"], record_types=(), run_mode="poll-open"
        )
