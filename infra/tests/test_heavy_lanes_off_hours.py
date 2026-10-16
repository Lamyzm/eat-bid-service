"""모듈 책임: 발행 mutex를 오래 쥐는 무거운 줄(전진 백필·재처리 전진)이 평일 업무 시간에 시작하지 않는다는 계약을 고정한다(EAT-362)."""

from __future__ import annotations

from conftest import ManifestSet

HEAVY_LANES = ("eatbid-backfill-advance", "eatbid-replay-advance")
# 정시 공고 수집이 08~19시에 돈다. 04시 회차까지만 08시 앞뒤에 끝난다고 본다(runtime §2.8).
BUSINESS_HOURS = set(range(5, 20))
WEEKDAYS = {1, 2, 3, 4, 5}


def _expand(field: str, low: int, high: int) -> set[int]:
    values: set[int] = set()
    for part in field.split(","):
        step = 1
        if "/" in part:
            part, step_text = part.split("/")
            step = int(step_text)
        if part == "*":
            start, end = low, high
        elif "-" in part:
            start_text, end_text = part.split("-")
            start, end = int(start_text), int(end_text)
        else:
            start = end = int(part)
        values.update(range(start, end + 1, step))
    return values


def test_무거운_줄은_평일_업무_시간에_시작하지_않는다(manifests: ManifestSet) -> None:
    """왜: 2026-10-16 08:25 재처리 회차가 58분 동안 발행 mutex를 쥐어 아침 개찰 결과가 화면에 들어오지 못했다.
    2026-10-14에는 백필 12시 회차가 공고 수집을 74분 비웠다."""
    for name in HEAVY_LANES:
        cron = manifests.named("CronWorkflow", name)
        for schedule in cron["spec"]["schedules"]:
            _minute, hour, _day, _month, weekday = str(schedule).split()
            days = _expand(weekday, 0, 6)
            if not days & WEEKDAYS:
                continue
            assert not _expand(hour, 0, 23) & BUSINESS_HOURS, (name, schedule)


def test_주말에는_무거운_줄이_계속_돈다(manifests: ManifestSet) -> None:
    """왜: 주말은 공고 수집이 쉰다. 평일을 비운 만큼 주말에 진도를 낸다."""
    for name in HEAVY_LANES:
        cron = manifests.named("CronWorkflow", name)
        weekend_hours: set[int] = set()
        for schedule in cron["spec"]["schedules"]:
            _minute, hour, _day, _month, weekday = str(schedule).split()
            if _expand(weekday, 0, 6) & {0, 6}:
                weekend_hours |= _expand(hour, 0, 23)
        assert len(weekend_hours) >= 6, (name, sorted(weekend_hours))
