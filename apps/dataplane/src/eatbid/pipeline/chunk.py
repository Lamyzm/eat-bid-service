"""모듈 책임: fan-out 한 건이 pod 하나이던 단계를 chunk 하나로 묶고 chunk 안 실패의 파급 범위를 정한다."""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from eatbid.failure_categories import (
    CONFIGURATION,
    DATA_QUARANTINED,
    EXIT_CODE_BY_CATEGORY,
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    TRANSIENT_NETWORK,
    failure_category_for_error,
)

__all__ = [
    "CONTINUABLE_FAILURE_CATEGORIES",
    "DEFAULT_CHUNK_SIZE",
    "ChunkItemOutcome",
    "ChunkOutcome",
    "run_chunk",
    "split_into_chunks",
]

# 왜 50인가. 2026-09-05~06 운영 실측에서 상세 한 건에 pod 하나를 띄우면 건당 약 17초였고 그중 소스
# 응답은 약 7초였다. 나머지는 pod 생성·wait 컨테이너·종료 비용이라 한 pod가 N건을 순차로 관측하면
# 그 고정 비용이 건당 N분의 1로 줄어든다. 50이면 건당 8초 아래로 내려가면서도 pod 하나의 수명이
# 10분대에 머물러 실패 시 다시 도는 범위가 크지 않다. 소스 동시 호출 수는 semaphore가 chunk pod
# 단위로 잡으므로 이 값을 올려도 늘지 않는다.
DEFAULT_CHUNK_SIZE = 50

# 왜: 다음 건을 계속 부를 수 있는지는 취향이 아니라 run ledger의 상태가 정한다. 소스가 차단하거나
# (`SOURCE_THROTTLED`) 계약을 어긴(`SOURCE_CONTRACT`) 관측은 그 자리에서 run을 실패로 닫으므로
# 뒤의 건은 terminal state로 거부될 뿐이고 소스만 한 번 더 두드린다. 설정 실패는 애초에 이 건의
# 문제가 아니다. 남는 것은 응답 자체가 오지 않은 전송 실패와 그 관측 하나에 갇힌 격리뿐이다.
CONTINUABLE_FAILURE_CATEGORIES = frozenset({TRANSIENT_NETWORK, DATA_QUARANTINED})

# 왜: 한 chunk가 여러 건을 처리하므로 실패 범주가 섞일 수 있는데 pod 종료 코드는 하나뿐이다.
# 운영이 먼저 알아야 하는 것은 "소스를 더 부르면 안 된다"와 "이 실행은 무엇을 해도 실패한다"라서
# 그 둘을 앞에 둔다.
_FAILURE_PRECEDENCE = (
    SOURCE_THROTTLED,
    CONFIGURATION,
    SOURCE_CONTRACT,
    DATA_QUARANTINED,
    TRANSIENT_NETWORK,
)


def split_into_chunks[Value](
    values: Sequence[Value], *, size: int = DEFAULT_CHUNK_SIZE
) -> tuple[tuple[Value, ...], ...]:
    """발견 순서를 유지한 채 고정 크기로 나눈다. 마지막 chunk만 작을 수 있다."""
    if isinstance(size, bool) or not isinstance(size, int) or size < 1:
        raise ValueError("chunk size must be a positive integer")
    ordered = tuple(values)
    return tuple(
        tuple(ordered[start : start + size]) for start in range(0, len(ordered), size)
    )


@dataclass(frozen=True, slots=True)
class ChunkItemOutcome[Result]:
    """chunk 안 한 건의 판정이다. 실패한 건은 결과가 없고 범주만 남는다."""

    key: str
    result: Result | None
    failure_category: str | None

    @property
    def succeeded(self) -> bool:
        return self.failure_category is None


@dataclass(frozen=True, slots=True)
class ChunkOutcome[Result]:
    attempted: tuple[ChunkItemOutcome[Result], ...]
    skipped: tuple[str, ...]

    @property
    def succeeded(self) -> tuple[ChunkItemOutcome[Result], ...]:
        return tuple(item for item in self.attempted if item.succeeded)

    @property
    def failed(self) -> tuple[ChunkItemOutcome[Result], ...]:
        return tuple(item for item in self.attempted if not item.succeeded)

    @property
    def exit_code(self) -> int:
        """왜: 한 건이라도 조용히 빠지면 성공이 아니다. 실패가 하나라도 있으면 비영 exit로 닫아
        DAG가 뒤 단계를 잇지 못하게 한다(`runtime-and-deployment.md` §3)."""
        categories = {item.failure_category for item in self.failed}
        for category in _FAILURE_PRECEDENCE:
            if category in categories:
                return EXIT_CODE_BY_CATEGORY[category]
        return 0


def run_chunk[Result](
    keys: Sequence[str],
    run_item: Callable[[str], Result],
    report_failure: Callable[[str, str, Exception], None],
) -> ChunkOutcome[Result]:
    """chunk를 순차로 실행하고 건별 실패를 그 건에 가둔다.

    왜 예외를 여기서 삼키나. 이 경계가 없으면 chunk의 첫 실패가 뒤의 49건을 관측조차 못 하게 만들어
    pod 하나가 곧 한 건이던 때보다 손실이 커진다. 대신 실패는 반드시 `report_failure`로 밖에 알리고
    `exit_code`로 다시 드러나므로 조용히 사라지지 않는다. 예외 객체는 provider 상세와 비밀값을
    실어 나르므로 이 모듈은 붙잡아 두지 않고 보고자에게 그대로 넘긴 뒤 범주만 남긴다.
    """
    ordered = tuple(keys)
    attempted: list[ChunkItemOutcome[Result]] = []
    for index, key in enumerate(ordered):
        try:
            result = run_item(key)
        except Exception as error:  # noqa: BLE001 - chunk는 건별 실패를 가두는 경계다.
            category = failure_category_for_error(error)
            report_failure(key, category, error)
            attempted.append(
                ChunkItemOutcome(key=key, result=None, failure_category=category)
            )
            if category not in CONTINUABLE_FAILURE_CATEGORIES:
                return ChunkOutcome(tuple(attempted), ordered[index + 1 :])
            continue
        attempted.append(
            ChunkItemOutcome(key=key, result=result, failure_category=None)
        )
    return ChunkOutcome(tuple(attempted), ())
