"""모듈 책임: 소스 차단 보류의 값 객체와 "다음엔 언제까지 부르지 않나"를 정하는 순수 규칙을 소유한다.

왜 순수 함수인가: 보류 간격은 DB 없이 검증할 수 있어야 한다. 읽고 쓰는 것은 ingest/postgres_hold_repository가
하고, 정시 실행이 보류를 어떻게 읽는지는 조립부가 정한다(ADR 0055 결정 3).

왜 지수인가: 소스가 계속 막으면 우리는 점점 뜸하게 두드려야 한다. 같은 간격으로 두드리면 차단이 굳는다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from uuid import UUID

from eatbid.pipeline.capture import SourceThrottledError

EAT_SOURCE = "eat"
REASON_THROTTLED = "source-throttled"

# 정시 실행만 보류를 본다. 사람이 부르는 backfill-pipeline·replay-pipeline은 그 사람이 보류를 알고 부른 것이고,
# replay는 소스를 부르지도 않는다.
SCHEDULED_SOURCE_MODES: frozenset[str] = frozenset({"poll-open", "daily-reconcile"})

# 지난 24시간에 걸린 보류 수에 따른 다음 보류 길이. 마지막 값이 상한이다.
HOLD_STEPS_MINUTES: tuple[int, ...] = (15, 30, 60, 120, 240, 480, 960, 1440)
RECENT_HOLD_WINDOW = timedelta(hours=24)


@dataclass(frozen=True)
class SourceHold:
    hold_id: int
    source: str
    reason: str
    detail: str
    held_at: datetime
    release_after: datetime
    held_by_run_id: UUID | None = None


def next_release_after(*, recent_holds: int, now: datetime) -> datetime:
    """지난 24시간에 걸린 보류가 n개면 n번째 단계의 길이만큼 보류한다. 상한은 하루다."""
    if recent_holds < 0:
        raise ValueError("recent_holds must not be negative")
    step = HOLD_STEPS_MINUTES[min(recent_holds, len(HOLD_STEPS_MINUTES) - 1)]
    return now + timedelta(minutes=step)


class SourceHeldError(SourceThrottledError):
    """정시 실행이 열린 보류를 보고 소스를 부르지 않은 채 끝났다.

    SourceThrottledError의 자식인 이유: exit code와 run failure_category가 같은 어휘(`SOURCE_THROTTLED`, 75)로
    떨어져야 운영자가 "소스가 막았다"와 "막혀서 안 불렀다"를 같은 자리에서 본다. status_code 0은 "부르지 않았다"다.
    """

    def __init__(self, hold: SourceHold) -> None:
        RuntimeError.__init__(
            self,
            f"source {hold.source} is held until {hold.release_after.isoformat()} ({hold.reason}: {hold.detail})",
        )
        self.status_code = 0
        self.hold = hold
