"""모듈 책임: 선언한 범위 안에서 다음에 채울 백필 창 하나를 커버리지 사실만 보고 고른다."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import date

__all__ = ["BackfillWindow", "CompletedWindow", "month_windows", "next_window"]


@dataclass(frozen=True, slots=True)
class BackfillWindow:
    """소스 목록 조회가 쓰는 날짜 창이다. `YYYYMMDD` 문자열 그대로 둔다 — 요청 파라미터가 그 모양이고
    커버리지 사실도 그 문자열로 기록돼 있어서, 여기서 날짜 타입으로 바꾸면 양쪽에서 다시 문자열로
    번역해야 한다."""

    start_date: str
    end_date: str


@dataclass(frozen=True, slots=True)
class CompletedWindow:
    """`ingest.backfill_coverage` 한 행에서 이 판단에 필요한 것만 가져온 값이다."""

    start_date: str
    end_date: str
    is_complete: bool


def _last_day(year: int, month: int) -> int:
    if month == 12:
        return 31
    return (date(year, month + 1, 1) - date(year, month, 1)).days


def month_windows(*, as_of: date, floor: date) -> tuple[BackfillWindow, ...]:
    """이번 달 **앞의** 달부터 floor가 든 달까지 최신순으로 만든다.

    이번 달을 빼는 이유는 그 달이 아직 자라고 있어서다. 열린 공고는 `poll-open`과
    `daily-reconcile`이 가져가며, 백필이 같은 달을 계속 다시 잡으면 영영 뒤로 못 간다.

    최신순인 이유는 최근이 관련성이 높고 사용자의 투찰 기록도 최근이기 때문이다(ADR 0052 결정 6).
    """
    if floor > as_of:
        return ()
    year, month = as_of.year, as_of.month
    windows: list[BackfillWindow] = []
    while True:
        month -= 1
        if month == 0:
            year, month = year - 1, 12
        if (year, month) < (floor.year, floor.month):
            break
        windows.append(
            BackfillWindow(
                start_date=f"{year:04d}{month:02d}01",
                end_date=f"{year:04d}{month:02d}{_last_day(year, month):02d}",
            )
        )
    return tuple(windows)


def next_window(
    *,
    as_of: date,
    floor: date,
    coverage: Iterable[CompletedWindow],
) -> BackfillWindow | None:
    """아직 끝나지 않은 가장 최근 달 하나를 돌려준다. 없으면 `None`이다.

    끝났다는 판정은 **그 달 전체를 덮는 창이 커버리지에 있고 완결**인 것이다. 과거에 반달씩 나눠 돌린
    창이 있어도 그것으로 갈음하지 않는다. 갈음하려면 날짜 구간의 합집합을 다뤄야 하고, 그 복잡함이
    사는 대가는 이미 받은 달을 한 번 더 받는 것뿐이다 — 지금 속도로 달마다 한 시간이고, 그 한 번이
    반달 창이 남긴 빈틈까지 메운다.

    이 함수가 상태를 저장하지 않는 것이 핵심이다. 커서를 따로 두면 백필이 실패했을 때 커서만 앞서
    있어 그 구간이 영원히 비고, 그 어긋남을 알아낼 방법이 다시 없어진다(ADR 0052 결정 2).
    """
    complete: Mapping[tuple[str, str], bool] = {
        (row.start_date, row.end_date): row.is_complete for row in coverage
    }
    for window in month_windows(as_of=as_of, floor=floor):
        if complete.get((window.start_date, window.end_date)) is True:
            continue
        return window
    return None
