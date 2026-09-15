"""모듈 책임: 기대 평가·상태 비교·알림 전송을 한 회차로 묶고 그 회차가 무엇을 했는지 돌려준다.

왜 회차 결과를 돌려주는가: 무엇이 새로 열렸고 무엇이 해소됐는지 남아야 한두 주 뒤에 기대 목록의 임계를
다시 판단할 수 있다(ADR 0046 Consequences).
"""

from __future__ import annotations

import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from .expectations import EXPECTATIONS, Expectation, QueryRunner, Violation, evaluate
from .notify import format_message, format_resolution
from .round import RoundMetrics, collect_round_metrics
from .state import decode_state, diff_violations, encode_state

RoundRecorder = Callable[[RoundMetrics], None]
"""회차 지표 한 행을 남기는 자리. 조립부가 DB 쓰기를 넣고, 검사에서는 목록에 모으는 함수를 넣는다."""

ViolationProbe = Callable[[], Sequence[Violation]]
"""DB 질의가 아닌 원천에서 위반을 읽어 오는 자리. 지금은 GitHub Actions 회차가 여기로 들어온다.

왜 같은 회차에 합치는가: 억제와 해소 판정이 한 상태 파일에서 돌아야 하기 때문이다. 원천마다 감시를 따로
두면 같은 사고가 여러 알림으로 쪼개지고, 그 사고가 하나인지 셋인지 받는 사람이 알 수 없다(ADR 0046 결정 6).
"""


class StateStore(Protocol):
    def read(self) -> Mapping[str, Any] | None: ...
    def write(self, document: Mapping[str, Any]) -> None: ...


class Notifier(Protocol):
    def __call__(self, text: str) -> None: ...


@dataclass(frozen=True)
class MonitoringResult:
    evaluated: int
    opened: tuple[str, ...]
    resolved: tuple[str, ...]
    still_open: tuple[str, ...]
    # 클러스터 밖으로 나간 심장박동. `sent`/`skipped`이며 실패는 값이 아니라 예외다 — 조립부가 회차가
    # 끝까지 끝난 뒤 채운다. 기본값이 skipped인 이유는 runner 자신은 밖을 모르기 때문이다.
    heartbeat: str = "skipped"
    # 회차 지표 행(monitoring.round)을 남겼는가. 기록자가 없으면 거짓이며, 있는데 실패하면 값이 아니라
    # 예외다 — 심장박동과 같은 규칙이다.
    round_recorded: bool = False


def run_expectation_check(
    *,
    run_query: QueryRunner,
    state_store: StateStore,
    notify: Notifier,
    environment: str,
    expectations: Sequence[Expectation] = EXPECTATIONS,
    probes: Sequence[ViolationProbe] = (),
    now: datetime | None = None,
    record_round: RoundRecorder | None = None,
    clock: Callable[[], float] = time.monotonic,
) -> MonitoringResult:
    """한 회차를 돌린다. 새로 열린 위반과 해소된 위반만 알린다."""
    started = clock()
    observed_at = now or datetime.now(UTC)
    moment = observed_at.isoformat()
    violations = evaluate(run_query, expectations)
    for probe in probes:
        violations.extend(probe())
    previous = decode_state(state_store.read())
    difference = diff_violations(violations, previous, now=moment)

    if difference.opened:
        notify(format_message(environment, difference.opened))
    if difference.resolved:
        notify(format_resolution(environment, difference.resolved))

    state_store.write(encode_state(difference.still_open, now=moment))

    # 지표 행은 판정과 알림이 모두 끝난 뒤에 남긴다. 판정 앞에 두면 지표 질의의 실패가 알림을 막고,
    # 지표는 알림의 근거가 아니다(ADR 0046 결정 4).
    round_recorded = False
    if record_round is not None:
        metrics = collect_round_metrics(
            run_query,
            now=observed_at,
            environment=environment,
            violations_open=len(difference.still_open),
            check_duration_ms=int((clock() - started) * 1000),
        )
        record_round(metrics)
        round_recorded = True

    return MonitoringResult(
        evaluated=len(expectations) + len(probes),
        opened=tuple(violation.key for violation in difference.opened),
        resolved=difference.resolved,
        still_open=tuple(item.key for item in difference.still_open),
        round_recorded=round_recorded,
    )
