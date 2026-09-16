"""모듈 책임: 기대 평가·상태 비교·표 기록·알림 전송을 한 회차로 묶고 그 회차가 무엇을 했는지 돌려준다.

왜 회차 결과를 돌려주는가: 무엇이 새로 열렸고 무엇이 해소됐는지 남아야 한두 주 뒤에 기대 목록의 임계를
다시 판단할 수 있다(ADR 0046 Consequences).

왜 재알림과 요약이 여기 있는가: "한 회차의 위반을 한 통으로 묶는다"와 "미해결이어도 다시 보내지 않는다"는
서로 다른 결정인데 한 문장에 묶여 5일 방치를 만들었다(ADR 0054 결정 1). 묶기는 그대로 두고, critical은
간격마다, 나머지는 아침 요약으로 다시 든다.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Protocol
from zoneinfo import ZoneInfo

from .expectations import EXPECTATIONS, Expectation, QueryRunner, Violation, evaluate
from .ledger import AppliedDiff
from .notify import (
    format_digest,
    format_message,
    format_repeat,
    format_resolution,
    parse_instant,
)
from .round import RoundMetrics, collect_round_metrics
from .state import OpenViolation, ViolationDiff, diff_violations

RoundRecorder = Callable[[RoundMetrics], None]
"""회차 지표 한 행을 남기는 자리. 조립부가 DB 쓰기를 넣고, 검사에서는 목록에 모으는 함수를 넣는다."""

ViolationProbe = Callable[[], Sequence[Violation]]
"""DB 질의가 아닌 원천에서 위반을 읽어 오는 자리. R2 백업 목록, Kubernetes API, GitHub이 여기로 들어온다.

왜 같은 회차에 합치는가: 억제와 해소 판정이 한 상태에서 돌아야 하기 때문이다. 원천마다 감시를 따로
두면 같은 사고가 여러 알림으로 쪼개지고, 그 사고가 하나인지 셋인지 받는 사람이 알 수 없다(ADR 0046 결정 6).
"""

SEOUL = ZoneInfo("Asia/Seoul")
CRITICAL = "critical"
REPEAT_AFTER = timedelta(hours=1)
DIGEST_HOUR = 9


class ViolationLedger(Protocol):
    def read_open(self) -> tuple[OpenViolation, ...]: ...
    def apply(self, diff: ViolationDiff, *, now: datetime) -> AppliedDiff: ...
    def mark_notified(self, violation_ids: Sequence[int], *, at: datetime) -> None: ...
    def record_notification(
        self,
        *,
        kind: str,
        violation_ids: Sequence[int | None],
        sent_at: datetime,
        ok: bool,
        error: str | None,
    ) -> None: ...
    def digest_sent_since(self, since: datetime) -> bool: ...


class Notifier(Protocol):
    def __call__(self, text: str) -> None: ...


@dataclass(frozen=True)
class MonitoringResult:
    evaluated: int
    opened: tuple[str, ...]
    resolved: tuple[str, ...]
    still_open: tuple[str, ...]
    # 이번 회차에 다시 알린 critical 위반의 key. 해소되지 않은 채 간격을 넘긴 것들이다.
    repeated: tuple[str, ...] = ()
    digest_sent: bool = False
    # 클러스터 밖으로 나간 심장박동. `sent`/`skipped`이며 실패는 값이 아니라 예외다 — 조립부가 회차가
    # 끝까지 끝난 뒤 채운다. 기본값이 skipped인 이유는 runner 자신은 밖을 모르기 때문이다.
    heartbeat: str = "skipped"
    # 회차 지표 행(monitoring.round)을 남겼는가. 기록자가 없으면 거짓이며, 있는데 실패하면 값이 아니라
    # 예외다 — 심장박동과 같은 규칙이다.
    round_recorded: bool = False


def _send(
    notify: Notifier,
    ledger: ViolationLedger,
    *,
    text: str,
    kind: str,
    violation_ids: Sequence[int | None],
    at: datetime,
) -> None:
    """한 통을 보내고 결과를 행으로 남긴다. 실패도 행이 되고, 그 다음 예외를 그대로 올린다 — 회차가 끝까지
    끝나지 않아야 바깥 심장박동이 신호 끊김을 알린다."""
    try:
        notify(text)
    except Exception as error:
        ledger.record_notification(
            kind=kind,
            violation_ids=violation_ids,
            sent_at=at,
            ok=False,
            error=f"{type(error).__name__}: {error}",
        )
        raise
    ledger.record_notification(
        kind=kind, violation_ids=violation_ids, sent_at=at, ok=True, error=None
    )


def _repeat_due(item: OpenViolation, *, now: datetime, after: timedelta) -> bool:
    if item.severity != CRITICAL:
        return False
    if item.last_notified_at is None:
        return True
    return now - parse_instant(item.last_notified_at) >= after


def _digest_window_start(now: datetime, *, hour: int) -> datetime | None:
    """요약을 보낼 회차인지. 그날 `hour`시의 회차들만 후보이고, 그날 이미 보냈으면 표가 막는다."""
    local = now.astimezone(SEOUL)
    if local.hour != hour:
        return None
    return local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)


def run_expectation_check(
    *,
    run_query: QueryRunner,
    ledger: ViolationLedger,
    notify: Notifier,
    environment: str,
    expectations: Sequence[Expectation] = EXPECTATIONS,
    probes: Sequence[ViolationProbe] = (),
    now: datetime | None = None,
    record_round: RoundRecorder | None = None,
    clock: Callable[[], float] = time.monotonic,
    repeat_after: timedelta = REPEAT_AFTER,
    digest_hour: int = DIGEST_HOUR,
) -> MonitoringResult:
    """한 회차를 돌린다. 새로 열린 위반과 해소된 위반을 알리고, 미해결 critical은 간격마다, 전체는 아침에 다시 든다."""
    started = clock()
    observed_at = now or datetime.now(UTC)
    moment = observed_at.isoformat()
    violations = evaluate(run_query, expectations)
    for probe in probes:
        violations.extend(probe())
    previous = ledger.read_open()
    difference = diff_violations(violations, previous, now=moment)
    applied = ledger.apply(difference, now=observed_at)
    by_key = {item.key: item for item in applied.still_open}

    if difference.opened:
        opened_ids = [
            by_key[violation.key].violation_id for violation in difference.opened
        ]
        _send(
            notify,
            ledger,
            text=format_message(environment, difference.opened),
            kind="opened",
            violation_ids=opened_ids,
            at=observed_at,
        )
        ledger.mark_notified([i for i in opened_ids if i is not None], at=observed_at)
    if difference.resolved:
        _send(
            notify,
            ledger,
            text=format_resolution(environment, difference.resolved),
            kind="resolved",
            violation_ids=[
                applied.resolved_ids.get(key) for key in difference.resolved
            ],
            at=observed_at,
        )

    opened_keys = {violation.key for violation in difference.opened}
    due = tuple(
        item
        for item in applied.still_open
        if item.key not in opened_keys
        and _repeat_due(item, now=observed_at, after=repeat_after)
    )
    if due:
        due_ids = [item.violation_id for item in due]
        _send(
            notify,
            ledger,
            text=format_repeat(environment, due, observed_at),
            kind="repeat",
            violation_ids=due_ids,
            at=observed_at,
        )
        ledger.mark_notified([i for i in due_ids if i is not None], at=observed_at)

    digest_sent = False
    day_start = _digest_window_start(observed_at, hour=digest_hour)
    if day_start is not None and not ledger.digest_sent_since(day_start):
        _send(
            notify,
            ledger,
            text=format_digest(environment, applied.still_open, observed_at),
            kind="digest",
            violation_ids=(),
            at=observed_at,
        )
        digest_sent = True

    # 지표 행은 판정과 알림이 모두 끝난 뒤에 남긴다. 판정 앞에 두면 지표 질의의 실패가 알림을 막고,
    # 지표는 알림의 근거가 아니다(ADR 0046 결정 4).
    round_recorded = False
    if record_round is not None:
        metrics = collect_round_metrics(
            run_query,
            now=observed_at,
            environment=environment,
            violations_open=len(applied.still_open),
            check_duration_ms=int((clock() - started) * 1000),
        )
        record_round(metrics)
        round_recorded = True

    return MonitoringResult(
        evaluated=len(expectations) + len(probes),
        opened=tuple(violation.key for violation in difference.opened),
        resolved=difference.resolved,
        still_open=tuple(item.key for item in applied.still_open),
        repeated=tuple(item.key for item in due),
        digest_sent=digest_sent,
        round_recorded=round_recorded,
    )
