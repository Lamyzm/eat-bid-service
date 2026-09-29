"""모듈 책임: 하루 두 번 상태 보고의 시각·계획 회차 수·구획 판정·문구·4096자 제한을 DB와 클러스터 없이 고정한다."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from eatbid.monitoring.explanation import explain
from eatbid.monitoring.report_schedule import (
    SEOUL,
    planned_poll_open_ticks,
    report_slot,
)
from eatbid.monitoring.state import UNOBSERVED, OpenViolation
from eatbid.monitoring.status_facts import (
    ApplicationFacts,
    CrawlerFacts,
    DatabaseFacts,
    PublicationFacts,
    ReconcileFacts,
    StatusReport,
    Unavailable,
    WorkloadFacts,
)
from eatbid.monitoring.status_report import (
    FAIL,
    OK,
    WARN,
    format_status_report,
    section_statuses,
)


def _kst(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 9, day, hour, minute, tzinfo=SEOUL)


# 2026-09-29은 화요일이다.
_저녁 = report_slot(_kst(29, 20, 18))
assert _저녁 is not None


def _정상_보고(**바꿀것: object) -> StatusReport:
    기본 = StatusReport(
        environment="prod",
        slot=_저녁,
        now=_kst(29, 20, 18),
        crawler=CrawlerFacts(
            planned=72,
            started=72,
            succeeded=72,
            failed=0,
            running=0,
            published=1234,
            excluded=0,
            last_success_at=_kst(29, 19, 57),
            average_duration=timedelta(minutes=6),
            longest_duration=timedelta(minutes=9),
            reconcile=ReconcileFacts(
                status="published",
                started_at=_kst(29, 7, 0),
                ended_at=_kst(29, 7, 21),
                published=512,
            ),
        ),
        publication=PublicationFacts(
            stale_validated=0,
            backfill_complete=60,
            backfill_total=60,
            unresolved_exclusions=0,
            unresolved_windows=0,
        ),
        backend=(
            WorkloadFacts("server", 1, 1, 0, None, 200),
            WorkloadFacts("web", 1, 1, 0, None, 200),
        ),
        database=DatabaseFacts(
            size_bytes=3 * 1024**3,
            volume_bytes=20 * 1024**3,
            last_backup_at=_kst(29, 20, 5),
        ),
        deploy=(
            ApplicationFacts(
                "eatbid-prod",
                "Synced",
                "Healthy",
                "3f9c2a1d0b",
                ("eatbid-server@sha256:0c6c0292fd12",),
            ),
        ),
        problems=(),
    )
    return replace(기본, **바꿀것)  # type: ignore[arg-type]


def _판정(report: StatusReport) -> dict[str, str]:
    return {name: status for name, status, _ in section_statuses(report)}


def test_아침_보고는_08시10분부터_두_시간_안의_회차가_보내고_어제_저녁부터를_센다() -> (
    None
):
    slot = report_slot(_kst(29, 8, 18))

    assert slot is not None
    assert slot.label == "밤사이"
    assert (slot.start, slot.end) == (_kst(28, 20, 10), _kst(29, 8, 10))
    assert slot.due_at == _kst(29, 8, 10).astimezone(UTC)
    assert report_slot(_kst(29, 8, 3)) is None
    assert report_slot(_kst(29, 10, 10)) is None


def test_저녁_보고는_자정부터_20시10분까지를_센다() -> None:
    slot = report_slot(_kst(29, 21, 48))

    assert slot is not None
    assert slot.label == "오늘 하루"
    assert (slot.start, slot.end) == (_kst(29, 0, 0), _kst(29, 20, 10))
    assert report_slot(_kst(29, 12, 3)) is None


@pytest.mark.parametrize(
    ("start", "end", "planned"),
    [
        (_kst(29, 0, 0), _kst(29, 20, 10), 72),  # 평일 하루 08:00~19:50
        (_kst(28, 20, 10), _kst(29, 8, 10), 1),  # 밤사이에는 08:00 한 번
        (_kst(27, 0, 0), _kst(27, 20, 10), 0),  # 일요일
        (_kst(29, 8, 5), _kst(29, 9, 0), 5),  # 08:10·20·30·40·50
    ],
    ids=["평일_하루", "밤사이", "일요일", "경계_중간"],
)
def test_정시_수집_계획_회차는_평일_08시부터_19시50분까지_10분마다다(
    start: datetime, end: datetime, planned: int
) -> None:
    assert planned_poll_open_ticks(start, end) == planned


def test_모두_정상이면_구획마다_정상이라고_말하고_위반이_없어도_보낸다() -> None:
    문구 = format_status_report(_정상_보고())

    assert 문구.startswith(
        "[prod] 오늘 하루 상태 보고 · 09-29 00:00 ~ 09-29 20:10\n✅ 전체 정상"
    )
    for name in ("크롤러", "발행", "백엔드·웹", "DB", "배포"):
        assert f"✅ {name} — 정상" in 문구
    assert "건너뛴 예약: 0회" in 문구
    assert "DB 크기: 3.0GiB / 볼륨 20.0GiB (약 15%, WAL 등 제외)" in 문구
    assert 문구.endswith("✅ 열린 문제 0건 — 없음")


def test_건너뛴_예약은_계획_대비_실행_부족분으로_센다() -> None:
    """실측: 08:00·08:30 회차가 각각 36분 걸려 사이 예약을 Forbid가 기록 없이 건너뛰었다."""
    크롤러 = replace(
        _정상_보고().crawler,  # type: ignore[type-var]
        started=66,
        succeeded=66,
        longest_duration=timedelta(minutes=36),
    )

    보고 = _정상_보고(crawler=크롤러)

    assert _판정(보고)["크롤러"] == WARN
    assert "건너뛴 예약: 6회 — 앞 회차가 길어" in format_status_report(보고)
    assert "최장 36분" in format_status_report(보고)


def test_계획이_있는데_성공이_하나도_없으면_크롤러는_문제다() -> None:
    크롤러 = replace(_정상_보고().crawler, started=3, succeeded=0, failed=3)  # type: ignore[type-var]

    assert _판정(_정상_보고(crawler=크롤러))["크롤러"] == FAIL


def test_일괄_대조가_기간에_없거나_실패하면_크롤러를_살펴보게_한다() -> None:
    없음 = replace(_정상_보고().crawler, reconcile=None)  # type: ignore[type-var]

    assert _판정(_정상_보고(crawler=없음))["크롤러"] == WARN
    assert "일괄 대조: 이 기간에 돌지 않음" in format_status_report(
        _정상_보고(crawler=없음)
    )


def test_모르는_값은_0이나_정상으로_뭉개지_않고_확인_못_함으로_적는다() -> None:
    모름 = Unavailable("PermissionError: 403")
    보고 = _정상_보고(
        crawler=모름,
        backend=모름,
        deploy=모름,
        database=DatabaseFacts(size_bytes=모름, volume_bytes=모름, last_backup_at=모름),
    )

    문구 = format_status_report(보고)

    assert 문구.count("확인 못 함(PermissionError: 403)") == 6
    assert {name: status for name, status in _판정(보고).items() if name != "발행"} == {
        "크롤러": WARN,
        "백엔드·웹": WARN,
        "DB": WARN,
        "배포": WARN,
    }
    assert "✅ 전체 정상" not in 문구


def test_백업이_세_시간_넘게_없으면_DB는_문제다() -> None:
    오래됨 = DatabaseFacts(
        size_bytes=1, volume_bytes=10, last_backup_at=_kst(29, 16, 5)
    )

    assert _판정(_정상_보고(database=오래됨))["DB"] == FAIL


def test_DB가_볼륨의_80퍼센트를_넘으면_살펴보게_한다() -> None:
    찼음 = DatabaseFacts(
        size_bytes=17 * 1024**3,
        volume_bytes=20 * 1024**3,
        last_backup_at=_kst(29, 20, 5),
    )

    assert _판정(_정상_보고(database=찼음))["DB"] == WARN


def test_준비가_모자라거나_응답이_오류면_백엔드는_문제고_기간_안_재시작은_살펴볼_것이다() -> (
    None
):
    죽음 = (WorkloadFacts("server", 0, 1, 4, None, 200),)
    오류 = (WorkloadFacts("web", 1, 1, 0, None, 502),)
    재시작 = (WorkloadFacts("server", 1, 1, 2, _kst(29, 13, 0), 200),)

    assert _판정(_정상_보고(backend=죽음))["백엔드·웹"] == FAIL
    assert _판정(_정상_보고(backend=오류))["백엔드·웹"] == FAIL
    assert _판정(_정상_보고(backend=재시작))["백엔드·웹"] == WARN


def test_배포가_저장소와_다르면_문제고_진행_중이면_살펴볼_것이다() -> None:
    다름 = (ApplicationFacts("eatbid-prod", "OutOfSync", "Healthy", None, ()),)
    진행 = (ApplicationFacts("eatbid-prod", "Synced", "Progressing", None, ()),)

    assert _판정(_정상_보고(deploy=다름))["배포"] == FAIL
    assert _판정(_정상_보고(deploy=진행))["배포"] == WARN


def _문제(index: int, *, severity: str = "normal") -> OpenViolation:
    return OpenViolation(
        key=f"k{index}",
        first_seen_at=(_kst(26, 9) + timedelta(minutes=index)).isoformat(),
        title=f"기대 {index}",
        severity=severity,
        explanation=explain(
            f"문제 {index}가 생겼습니다" + "…" * 30,
            "화면 일부가 비어 보입니다" + "…" * 30,
            severity=severity,
        ),
    )


def test_열린_문제는_한_줄씩_나이_무슨_일_영향_급함을_적는다() -> None:
    보고 = _정상_보고(problems=(_문제(1, severity="critical"),))

    문구 = format_status_report(보고)

    assert "❌ 열린 문제 1건\n❌ 3일째 · 문제 1가 생겼습니다" in 문구
    assert "   영향: 화면 일부가 비어 보입니다" in 문구
    assert "   급함: 지금 봐야 함" in 문구
    assert 문구.splitlines()[1] == "❌ 살펴볼 곳 1곳: 열린 문제"


def test_관측_못_한_채_물려받은_문제는_설명을_지어내지_않는다() -> None:
    물려받음 = OpenViolation(
        key="node-health:not-ready:vm",
        first_seen_at=_kst(29, 9).isoformat(),
        title="노드가 정상이다",
        severity="critical",
        observation=UNOBSERVED,
    )

    문구 = format_status_report(_정상_보고(problems=(물려받음,)))

    assert "노드가 정상이다 (이번엔 확인 못 함)" in 문구
    assert "영향: 확인 못 함" in 문구


def test_문제가_많아도_4096자를_넘지_않고_넘친_문제는_몇_건인지_남긴다() -> None:
    보고 = _정상_보고(problems=tuple(_문제(index) for index in range(60)))

    문구 = format_status_report(보고)

    assert len(문구) <= 4096
    assert "외 " in 문구 and "(monitoring.violation 표에 전부 있음)" in 문구
    # 구획 보고가 문제 목록에 밀려 잘리지 않는다.
    assert "✅ 배포 — 정상" in 문구
    assert OK in 문구
