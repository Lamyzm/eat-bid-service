"""모듈 책임: 기대 평가·상태 비교·알림 전송을 한 회차로 묶고 그 회차가 무엇을 했는지 돌려준다.

왜 회차 결과를 돌려주는가: 무엇이 새로 열렸고 무엇이 해소됐는지 남아야 한두 주 뒤에 기대 목록의 임계를
다시 판단할 수 있다(ADR 0046 Consequences).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from .expectations import EXPECTATIONS, Expectation, QueryRunner, evaluate
from .notify import format_message, format_resolution
from .state import decode_state, diff_violations, encode_state


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


def run_expectation_check(
    *,
    run_query: QueryRunner,
    state_store: StateStore,
    notify: Notifier,
    environment: str,
    expectations: Sequence[Expectation] = EXPECTATIONS,
    now: datetime | None = None,
) -> MonitoringResult:
    """한 회차를 돌린다. 새로 열린 위반과 해소된 위반만 알린다."""
    moment = (now or datetime.now(UTC)).isoformat()
    violations = evaluate(run_query, expectations)
    previous = decode_state(state_store.read())
    difference = diff_violations(violations, previous, now=moment)

    if difference.opened:
        notify(format_message(environment, difference.opened))
    if difference.resolved:
        notify(format_resolution(environment, difference.resolved))

    state_store.write(encode_state(difference.still_open, now=moment))
    return MonitoringResult(
        evaluated=len(expectations),
        opened=tuple(violation.key for violation in difference.opened),
        resolved=difference.resolved,
        still_open=tuple(item.key for item in difference.still_open),
    )
