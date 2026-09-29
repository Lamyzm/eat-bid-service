"""모듈 책임: 하루 두 번 상태 보고의 시각·대상 기간과 그 기간의 정시 수집 계획 회차 수를 순수 계산으로 정한다.

왜 시각이 둘인가: 아침 한 통의 위반 목록만으로는 "지금 괜찮은가"를 알 수 없었고, 위반이 없으면 한 줄뿐이라
감시가 살아 있는지조차 흐렸다(2026-09-29, EAT-299). 밤사이를 아침에, 영업시간 전체를 저녁에 한 번씩 본다.
10분에 맞춘 이유는 정각 회차(poll-open 08:00·백업 :05)가 막 끝난 뒤의 모습을 보려는 것이다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

SEOUL = ZoneInfo("Asia/Seoul")

MORNING = time(8, 10)
EVENING = time(20, 10)

REPORT_GRACE = timedelta(hours=2)
"""보고 시각 뒤 이만큼 안의 회차만 보고를 보낸다. 감시는 :03·:18·:33·:48에 돌므로 08:10 보고는 08:18 회차가
보낸다. 그 회차가 실패하면 다음 회차가 다시 시도한다. 두 시간을 넘기면 보내지 않는다 — 오후에 "밤사이" 보고가
오면 기간이 틀린 보고가 되고, 감시가 그만큼 죽어 있던 사실은 바깥 심장박동이 이미 알린다(ADR 0046 결정 6)."""

POLL_OPEN_SCHEDULE = "*/10 8-19 * * 1-5"
"""정시 수집 CronWorkflow의 schedule 문자열(`infra/base/workflows/poll-open.yaml`).

왜 manifest를 읽지 않고 상수로 두는가: 감시 ServiceAccount는 CronWorkflow를 읽을 권한이 없고, 이 한 줄을 풀려고
cron 파서 의존성과 읽기 권한을 더할 값이 없다. 대신 `infra/tests/test_monitoring_contract.py`가 manifest의
schedule과 이 문자열이 같은지 고정한다 — 주기를 바꾸는 커밋은 여기서 CI가 먼저 깨진다. 아래 세 값은 이 문자열을
그대로 풀어 적은 것이며, 같은 검사가 둘이 어긋나지 않는지도 본다.
"""
POLL_OPEN_EVERY_MINUTES = 10
POLL_OPEN_HOURS = range(8, 20)
POLL_OPEN_ISO_WEEKDAYS = range(1, 6)


@dataclass(frozen=True)
class ReportSlot:
    """보고 한 통의 자리. `due_at`은 원장 중복 판정의 기준이고 `[start, end)`는 숫자를 세는 기간이다.

    기간의 끝을 실제 발송 시각이 아니라 `due_at`으로 두는 이유: 08:18에 보내든 08:33에 다시 보내든 같은 보고가
    같은 숫자를 내야 한다.
    """

    label: str
    due_at: datetime
    start: datetime
    end: datetime


def _at(day: datetime, moment: time) -> datetime:
    return datetime.combine(day.date(), moment, tzinfo=SEOUL)


def report_slot(now: datetime) -> ReportSlot | None:
    """지금 회차가 보낼 보고 자리. 보고 시각 뒤 유예 안이 아니면 없다."""
    local = now.astimezone(SEOUL)
    morning = _at(local, MORNING)
    evening = _at(local, EVENING)
    if evening <= local < evening + REPORT_GRACE:
        # "오늘 하루"는 자정부터다. 새벽 재대조(07:00)와 아침 첫 수집이 저녁 보고에서도 빠지지 않는다.
        return ReportSlot(
            label="오늘 하루",
            due_at=evening.astimezone(UTC),
            start=_at(local, time(0, 0)).astimezone(UTC),
            end=evening.astimezone(UTC),
        )
    if morning <= local < morning + REPORT_GRACE:
        return ReportSlot(
            label="밤사이",
            due_at=morning.astimezone(UTC),
            start=(evening - timedelta(days=1)).astimezone(UTC),
            end=morning.astimezone(UTC),
        )
    return None


def planned_poll_open_ticks(start: datetime, end: datetime) -> int:
    """`[start, end)` 안에 정시 수집이 예약된 회차 수. 공휴일도 cron은 돌므로 평일이면 센다."""
    local = start.astimezone(SEOUL)
    step = timedelta(minutes=POLL_OPEN_EVERY_MINUTES)
    minute = local.minute - local.minute % POLL_OPEN_EVERY_MINUTES
    tick = local.replace(minute=minute, second=0, microsecond=0)
    if tick < local:
        tick += step
    count = 0
    stop = end.astimezone(SEOUL)
    while tick < stop:
        if tick.isoweekday() in POLL_OPEN_ISO_WEEKDAYS and tick.hour in POLL_OPEN_HOURS:
            count += 1
        # 벽시계로 더한다. 서울은 일광절약이 없어 벽시계와 절대 시각이 같이 간다.
        tick += step
    return count
