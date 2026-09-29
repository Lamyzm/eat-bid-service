"""발행 뒤 mart 단계와 과거 기록 mart 예약이 어느 mart를 다시 만들지 고르는 규칙을 DB 없이 확인한다(ADR 0060)."""

from __future__ import annotations

from uuid import UUID

import pytest

from eatbid.mart.build_marts import HISTORY_MARTS, OPEN_AUCTION_MARTS, resolve_marts
from eatbid.mart.history_schedule import (
    ActiveBuildKey,
    HistorySchedule,
    PublishedInput,
    history_marts_to_build,
)
from eatbid.mart.models import MART_NAMES
from eatbid.mart.repository import MartBuildContractError

SNAPSHOT = "open_auction_snapshot"
RELEASE = UUID("00000000-0000-0000-0000-000000000001")
LATEST = UUID("00000000-0000-0000-0000-000000000002")
OLDER = UUID("00000000-0000-0000-0000-000000000003")


def test_과거_기록_mart와_스냅샷_mart를_합치면_mart_이름_전부다() -> None:
    assert tuple(HISTORY_MARTS) + tuple(OPEN_AUCTION_MARTS) == MART_NAMES


@pytest.mark.parametrize("run_mode", ["poll-open", "daily-reconcile"])
def test_열린_공고를_읽는_run의_발행_뒤에는_스냅샷만_만든다(run_mode: str) -> None:
    # 과거 기록 mart까지 만들던 때 poll-open 한 회차가 36~46분이 되어 사이 회차가 건너뛰어졌다.
    assert resolve_marts(requested=None, run_mode=run_mode) == (SNAPSHOT,)


@pytest.mark.parametrize(
    "run_mode", ["backfill", "replay", "reference", None, "unknown"]
)
def test_사람이_과거_창_발행으로_부르면_스냅샷_없이_과거_기록_mart를_만든다(
    run_mode: str | None,
) -> None:
    # 마감된 과거 공고로 스냅샷 활성 build를 물리면 오늘 화면이 빈다(EAT-98).
    resolved = resolve_marts(requested=None, run_mode=run_mode)
    assert resolved == HISTORY_MARTS
    assert not set(OPEN_AUCTION_MARTS) & set(resolved)


def test_mart_이름을_직접_주면_run_mode와_무관하게_그대로_쓴다() -> None:
    assert resolve_marts(requested=[SNAPSHOT], run_mode="backfill") == (SNAPSHOT,)
    assert resolve_marts(requested=["org_round_summary"], run_mode="poll-open") == (
        "org_round_summary",
    )
    with pytest.raises(MartBuildContractError):
        resolve_marts(requested=["supplier_monthly_record"], run_mode="poll-open")


def _schedule(active: dict[str, ActiveBuildKey]) -> HistorySchedule:
    return HistorySchedule(
        latest=PublishedInput(source_release_id=RELEASE, publication_id=LATEST),
        active=active,
    )


def test_최신_발행을_같은_규칙으로_반영한_활성_build가_있으면_예약은_아무것도_만들지_않는다() -> (
    None
):
    current = ActiveBuildKey(publication_id=LATEST, calc_version="mart-r11")
    schedule = _schedule({name: current for name in HISTORY_MARTS})

    assert history_marts_to_build(schedule, calc_version="mart-r11") == ()


def test_새_발행이_있으면_그것을_반영하지_않은_과거_기록_mart만_만든다() -> None:
    schedule = _schedule(
        {
            "org_round_summary": ActiveBuildKey(
                publication_id=OLDER, calc_version="mart-r11"
            ),
            "win_rate_distribution_monthly": ActiveBuildKey(
                publication_id=LATEST, calc_version="mart-r11"
            ),
            # 스냅샷은 발행 DAG의 몫이라 예약이 보지 않는다.
            SNAPSHOT: ActiveBuildKey(publication_id=OLDER, calc_version="mart-r11"),
        }
    )

    assert history_marts_to_build(schedule, calc_version="mart-r11") == (
        "org_round_summary",
    )


def test_계산_규칙이_바뀌면_같은_발행이라도_다시_만든다() -> None:
    old_rule = ActiveBuildKey(publication_id=LATEST, calc_version="mart-r11")
    schedule = _schedule({name: old_rule for name in HISTORY_MARTS})

    assert history_marts_to_build(schedule, calc_version="mart-r12") == HISTORY_MARTS


def test_활성_build가_없거나_수동_전량_재빌드뿐이면_최신_발행으로_만든다() -> None:
    manual = ActiveBuildKey(publication_id=None, calc_version="mart-r11")
    schedule = _schedule({"org_round_summary": manual})

    assert history_marts_to_build(schedule, calc_version="mart-r11") == HISTORY_MARTS


def test_발행이_하나도_없으면_만들_입력이_없다() -> None:
    schedule = HistorySchedule(latest=None, active={})

    assert history_marts_to_build(schedule, calc_version="mart-r11") == ()
