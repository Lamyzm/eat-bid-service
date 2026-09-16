"""모듈 책임: 다음 백필 창을 고르는 규칙이 커버리지 사실만으로 결정되는지 고정한다."""

from __future__ import annotations

from datetime import date

from eatbid.pipeline.advance import CompletedWindow, month_windows, next_window


def _완결(start: str, end: str) -> CompletedWindow:
    return CompletedWindow(start_date=start, end_date=end, is_complete=True)


def _미완(start: str, end: str) -> CompletedWindow:
    return CompletedWindow(start_date=start, end_date=end, is_complete=False)


def test_이번_달은_빼고_앞의_달부터_최신순으로_만든다() -> None:
    # 이번 달은 아직 자라고 있고 poll-open이 가져간다. 백필이 그 달을 계속 잡으면 영영 뒤로 못 간다.
    windows = month_windows(as_of=date(2026, 9, 14), floor=date(2026, 6, 1))

    assert [(w.start_date, w.end_date) for w in windows] == [
        ("20260801", "20260831"),
        ("20260701", "20260731"),
        ("20260601", "20260630"),
    ]


def test_윤년_2월과_해_넘김을_날짜로_센다() -> None:
    windows = month_windows(as_of=date(2026, 1, 5), floor=date(2025, 11, 1))

    assert [(w.start_date, w.end_date) for w in windows] == [
        ("20251201", "20251231"),
        ("20251101", "20251130"),
    ]

    leap = month_windows(as_of=date(2028, 3, 1), floor=date(2028, 2, 1))
    assert [(w.start_date, w.end_date) for w in leap] == [("20280201", "20280229")]


def test_완결되지_않은_가장_최근_달을_고른다() -> None:
    window = next_window(
        as_of=date(2026, 9, 14),
        floor=date(2026, 6, 1),
        coverage=[_완결("20260801", "20260831")],
    )

    assert window is not None
    assert (window.start_date, window.end_date) == ("20260701", "20260731")


def test_완결이_아닌_행은_아직_할_일로_본다() -> None:
    window = next_window(
        as_of=date(2026, 9, 14),
        floor=date(2026, 8, 1),
        coverage=[_미완("20260801", "20260831")],
    )

    assert window is not None
    assert (window.start_date, window.end_date) == ("20260801", "20260831")


def test_반달_창은_그_달을_끝냈다고_갈음하지_않는다() -> None:
    # 반달 창이 남긴 빈틈을 갈음으로 덮으면 그 빈틈이 영원히 안 보인다. 한 번 더 받는 대가를 치른다.
    window = next_window(
        as_of=date(2026, 9, 14),
        floor=date(2026, 8, 1),
        coverage=[_완결("20260801", "20260815"), _완결("20260816", "20260831")],
    )

    assert window is not None
    assert (window.start_date, window.end_date) == ("20260801", "20260831")


def test_범위_안이_모두_끝나면_아무것도_고르지_않는다() -> None:
    window = next_window(
        as_of=date(2026, 9, 14),
        floor=date(2026, 8, 1),
        coverage=[_완결("20260801", "20260831")],
    )

    assert window is None


def test_floor가_미래면_고를_창이_없다() -> None:
    assert month_windows(as_of=date(2026, 9, 14), floor=date(2027, 1, 1)) == ()
    assert next_window(as_of=date(2026, 9, 14), floor=date(2027, 1, 1), coverage=[]) is None


def _발행실패(start: str, end: str) -> CompletedWindow:
    return CompletedWindow(start_date=start, end_date=end, is_complete=False, failed_publications=1)


def test_발행이_실패한_창은_건너뛰고_그_앞의_달로_간다() -> None:
    # 2026-03 창을 매시 다시 받아 같은 격리로 다시 죽었다(EAT-235). 다시 받을 일이 아니라 replay할 일이다.
    window = next_window(
        as_of=date(2026, 9, 16),
        floor=date(2026, 1, 1),
        coverage=[_완결("20260801", "20260831"), _발행실패("20260301", "20260331")],
    )

    assert window is not None
    assert (window.start_date, window.end_date) == ("20260701", "20260731")


def test_발행_실패_창이_완결되면_다시_보지_않는다() -> None:
    # replay가 성공하면 revision이 생겨 is_complete가 참이 된다. 실패 흔적은 남아도 할 일은 없다.
    window = next_window(
        as_of=date(2026, 4, 10),
        floor=date(2026, 3, 1),
        coverage=[CompletedWindow(start_date="20260301", end_date="20260331", is_complete=True, failed_publications=1)],
    )

    assert window is None