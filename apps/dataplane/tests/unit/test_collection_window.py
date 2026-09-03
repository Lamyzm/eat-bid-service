from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from eatbid.pipeline.collection_window import (
    COLLECTION_MODES,
    DAILY_RECONCILE_LOOKBACK,
    resolve_collection_window,
)

# 서울 2026-09-04 00:30 = UTC 2026-09-03 15:30. 날짜 경계를 서울 달력으로 자르는지 본다.
SEOUL_MIDNIGHT_EDGE = datetime(2026, 9, 3, 15, 30, tzinfo=UTC)


def test_poll_open은_서울_기준_오늘_하루_창이다() -> None:
    window = resolve_collection_window("poll-open", as_of=SEOUL_MIDNIGHT_EDGE)

    assert (window.start_date, window.end_date) == ("20260904", "20260904")


def test_daily_reconcile은_오늘을_포함한_7일_창이다() -> None:
    window = resolve_collection_window("daily-reconcile", as_of=SEOUL_MIDNIGHT_EDGE)

    assert DAILY_RECONCILE_LOOKBACK == timedelta(days=6)
    assert (window.start_date, window.end_date) == ("20260829", "20260904")


def test_backfill은_사람이_지정한_구간만_받는다() -> None:
    window = resolve_collection_window(
        "backfill",
        as_of=SEOUL_MIDNIGHT_EDGE,
        start_date="20250901",
        end_date="20251130",
    )

    assert (window.start_date, window.end_date) == ("20250901", "20251130")
    with pytest.raises(ValueError):
        resolve_collection_window("backfill", as_of=SEOUL_MIDNIGHT_EDGE)


@pytest.mark.parametrize("mode", ["poll-open", "daily-reconcile"])
def test_예약_모드에_날짜를_함께_주면_추측하지_않고_거부한다(mode: str) -> None:
    with pytest.raises(ValueError):
        resolve_collection_window(
            mode, as_of=SEOUL_MIDNIGHT_EDGE, start_date="20260901", end_date="20260901"
        )


def test_알_수_없는_모드와_naive_시각은_거부한다() -> None:
    with pytest.raises(ValueError):
        resolve_collection_window("replay", as_of=SEOUL_MIDNIGHT_EDGE)
    with pytest.raises(ValueError):
        resolve_collection_window(
            "poll-open", as_of=datetime(2026, 9, 4, 0, 30)  # noqa: DTZ001
        )
    assert COLLECTION_MODES == ("poll-open", "daily-reconcile", "backfill")
