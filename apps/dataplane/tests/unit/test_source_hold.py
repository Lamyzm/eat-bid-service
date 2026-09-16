from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from eatbid.failures.categories import SOURCE_THROTTLED, failure_category_for_error
from eatbid.pipeline.source_hold import (
    HOLD_STEPS_MINUTES,
    SCHEDULED_SOURCE_MODES,
    SourceHeldError,
    SourceHold,
    next_release_after,
)

_지금 = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)


def test_보류_길이는_지난_하루의_보류_수에_따라_15분부터_두_배씩_늘고_하루에서_멈춘다() -> (
    None
):
    길이들 = [
        next_release_after(recent_holds=n, now=_지금) - _지금
        for n in range(len(HOLD_STEPS_MINUTES) + 3)
    ]

    assert 길이들[:4] == [
        timedelta(minutes=15),
        timedelta(minutes=30),
        timedelta(minutes=60),
        timedelta(minutes=120),
    ]
    assert 길이들[-1] == timedelta(hours=24)
    assert 길이들[len(HOLD_STEPS_MINUTES) - 1] == timedelta(hours=24)


def test_보류_수가_음수면_거부한다() -> None:
    with pytest.raises(ValueError):
        next_release_after(recent_holds=-1, now=_지금)


def test_보류_때문에_안_부른_것은_소스가_막은_것과_같은_어휘로_끝난다() -> None:
    """운영자는 exit 75와 SOURCE_THROTTLED를 한 자리에서 본다. 다른 점은 status_code 0, 즉 부르지 않았다는 것뿐이다."""
    보류 = SourceHold(
        hold_id=1,
        source="eat",
        reason="source-throttled",
        detail="HTTP 429 on bid-detail",
        held_at=_지금,
        release_after=_지금 + timedelta(minutes=15),
    )

    오류 = SourceHeldError(보류)

    assert failure_category_for_error(오류) == SOURCE_THROTTLED
    assert 오류.status_code == 0
    assert "held until" in str(오류)


def test_정시_수집_모드만_보류를_본다() -> None:
    assert SCHEDULED_SOURCE_MODES == {"poll-open", "daily-reconcile"}
    assert "backfill" not in SCHEDULED_SOURCE_MODES
