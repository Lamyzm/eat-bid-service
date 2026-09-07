"""`resolve_marts`가 발행마다 어느 mart를 다시 만들지 고르는 규칙을 DB 없이 확인한다."""

from __future__ import annotations

import pytest

from eatbid.mart.build_marts import OPEN_AUCTION_MARTS, resolve_marts
from eatbid.mart.models import MART_NAMES
from eatbid.mart.repository import MartBuildContractError

SNAPSHOT = "open_auction_snapshot"


def test_auction_v2_발행은_core_입력_mart_둘과_열린_공고_스냅샷을_함께_만든다() -> None:
    assert resolve_marts(requested=None, record_types=("auction.v2",)) == (
        "org_round_summary",
        "win_rate_distribution_monthly",
        SNAPSHOT,
    )


def test_auction_v1_발행은_분포를_빼되_열린_공고_스냅샷은_만든다() -> None:
    assert resolve_marts(requested=None, record_types=("auction.v1",)) == (
        "org_round_summary",
        SNAPSHOT,
    )


def test_record_type이_없는_발행도_열린_공고_스냅샷을_만든다() -> None:
    # 목록만 실린 poll-open(상세 request unit 0건)이 이 모양이다. 셋 다 다시 만든다.
    resolved = resolve_marts(requested=None, record_types=())
    assert resolved == MART_NAMES
    assert set(OPEN_AUCTION_MARTS) <= set(resolved)


def test_같은_record_type이_겹쳐도_mart는_한_번씩만_고른다() -> None:
    assert resolve_marts(
        requested=None, record_types=("auction.v2", "auction.v1", "auction.v2")
    ) == ("org_round_summary", "win_rate_distribution_monthly", SNAPSHOT)


def test_모르는_record_type은_조용히_무시하지_않고_셋_다_만든다() -> None:
    assert resolve_marts(requested=None, record_types=("auction.v9",)) == MART_NAMES


def test_mart_이름을_직접_주면_스냅샷을_더하지_않고_그대로_쓴다() -> None:
    assert resolve_marts(
        requested=["org_round_summary"], record_types=("auction.v2",)
    ) == ("org_round_summary",)
    with pytest.raises(MartBuildContractError):
        resolve_marts(requested=["supplier_monthly_record"], record_types=())
