"""모듈 책임: source 호출의 일시 실패를 판정하고 상한이 걸린 재시도 대기 간격을 만든다."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import timedelta

Sleeper = Callable[[timedelta], None]

# 왜: 이 분류의 기준은 "심각한가"가 아니라 "같은 요청을 다시 보내면 결과가 달라질 수 있는가"다.
# 연결·전송 실패는 다음 시도에서 성공할 수 있지만, 응답을 다 받은 뒤의 decoding 실패나 크기 초과는
# 소스가 실제로 그렇게 보냈다는 관측이라 몇 번을 더 보내도 같은 결론이 나온다.
TRANSIENT_TRANSPORT_CATEGORIES: frozenset[str] = frozenset(
    {
        "connect-timeout",
        "read-timeout",
        "write-timeout",
        "pool-timeout",
        "connect-error",
        "read-error",
        "write-error",
        "close-error",
        "protocol-error",
        "transport-error",
        "request-error",
    }
)

_NO_DELAY = timedelta(0)


def is_transient_status(status_code: int) -> bool:
    """5xx는 소스가 지금 처리하지 못한다는 뜻이므로 계약 위반과 구분해 다시 시도한다."""
    return 500 <= status_code <= 599


def sleep_between_attempts(delay: timedelta) -> None:
    """왜: 대기 간격은 단위를 가진 timedelta로만 전달되고 초 변환은 이 경계에서 한 번만 한다."""
    time.sleep(delay.total_seconds())


@dataclass(frozen=True, slots=True)
class TransientRetryPolicy:
    """왜: WorkflowTemplate에는 의도적으로 `retryStrategy`가 없고 source semaphore가 소스 호출을
    pod 하나로 직렬화한다. 그래서 일시 실패를 다시 시도할 수 있는 유일한 자리는 semaphore 안에서
    도는 이 프로세스이며, 그 상한도 manifest가 아니라 이 값 객체가 소유한다."""

    # 기본값은 config.py의 SOURCE_RETRY_* 기본값과 같다. 둘이 어긋나면 설정 없이 조립한 client와 운영
    # pod가 서로 다른 예산으로 돈다.
    max_attempts: int = 5
    initial_backoff: timedelta = timedelta(seconds=5)
    backoff_multiplier: int = 2
    max_total_backoff: timedelta = timedelta(seconds=120)

    def __post_init__(self) -> None:
        if self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if self.backoff_multiplier < 1:
            raise ValueError("backoff_multiplier must be at least 1")
        if self.initial_backoff < _NO_DELAY:
            raise ValueError("initial_backoff must not be negative")
        if self.max_total_backoff < _NO_DELAY:
            raise ValueError("max_total_backoff must not be negative")

    def backoff_delays(self) -> tuple[timedelta, ...]:
        """왜: 재시도 대기의 합이 단계 timeout을 넘으면 fail-closed가 아니라 hang이 된다. 남은
        예산으로 지수 증가분을 자르고, 예산이 바닥나면 남은 시도를 열지 않아 소스를 대기 없이
        연타하지도 않는다. 반환 길이가 곧 재시도 횟수이며 총 대기는 `max_total_backoff` 이내다."""
        delays: list[timedelta] = []
        remaining = self.max_total_backoff
        delay = self.initial_backoff
        for _ in range(self.max_attempts - 1):
            granted = min(delay, remaining)
            if granted <= _NO_DELAY < delay:
                break
            delays.append(granted)
            remaining -= granted
            delay = delay * self.backoff_multiplier
        return tuple(delays)


DEFAULT_TRANSIENT_RETRY_POLICY = TransientRetryPolicy()
