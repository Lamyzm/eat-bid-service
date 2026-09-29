"""모듈 책임: 하루 두 번 상태 보고의 사실 묶음을 받아 구획마다 ✅/⚠️/❌와 사람 말 문장으로 조립하는 순수 함수를 소유한다.

왜 사실과 문구를 나누는가: 무엇을 세는지(status_collect·status_cluster)와 그것을 어떻게 판정해 말하는지(여기)는
바뀌는 이유가 다르다. 판정 경계와 4096자 제한은 DB·클러스터 없이 검증할 수 있어야 한다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta

from .backup import BACKUP_EXPECTATIONS
from .explanation import Explanation, urgency_for
from .notify import age_text, parse_instant, truncate
from .report_schedule import SEOUL, ReportSlot
from .state import UNOBSERVED, OpenViolation
from .status_facts import (
    ApplicationFacts,
    CrawlerFacts,
    DatabaseFacts,
    PublicationFacts,
    StatusReport,
    Unavailable,
    WorkloadFacts,
)

OK, WARN, FAIL = "✅", "⚠️", "❌"
_WORDS = {OK: "정상", WARN: "살펴볼 것 있음", FAIL: "문제 있음"}

# 보고와 알림이 서로 다른 선으로 판정하면 "보고는 ❌인데 알림이 없다"가 생긴다. 백업 기대의 임계를 그대로 쓴다.
BACKUP_STALE_AFTER = BACKUP_EXPECTATIONS[0].stale_after

DISK_WARN_PERCENT = 80


def _clock(moment: datetime) -> str:
    return moment.astimezone(SEOUL).strftime("%m-%d %H:%M")


def _minutes(span: timedelta) -> str:
    total = max(int(span.total_seconds() // 60), 0)
    if total < 60:
        return f"{total}분"
    hours, minutes = divmod(total, 60)
    return f"{hours}시간 {minutes}분" if minutes else f"{hours}시간"


def _size(size: int) -> str:
    gib = 1024**3
    if size >= gib:
        return f"{size // gib}.{size % gib * 10 // gib}GiB"
    return f"{size // 1024**2}MiB"


def _crawler(facts: CrawlerFacts | Unavailable, now: datetime) -> tuple[str, list[str]]:
    if isinstance(facts, Unavailable):
        return WARN, [f"· {facts}"]
    status = OK
    if facts.planned > 0 and facts.succeeded == 0 and facts.running == 0:
        status = FAIL
    elif facts.skipped or facts.failed:
        status = WARN
    lines = [
        (
            f"· 정시 수집: 계획 {facts.planned}회 중 {facts.started}회 실행 "
            f"(성공 {facts.succeeded}, 실패 {facts.failed}, 진행 중 {facts.running})"
        ),
        f"· 건너뛴 예약: {facts.skipped}회"
        + (
            " — 앞 회차가 길어 겹친 예약은 기록 없이 건너뜁니다"
            if facts.skipped
            else ""
        ),
        "· 마지막 성공: "
        + (
            f"{_clock(facts.last_success_at)} ({_minutes(now - facts.last_success_at)} 전)"
            if facts.last_success_at is not None
            else "기록 없음"
        ),
    ]
    if facts.average_duration is not None and facts.longest_duration is not None:
        lines.append(
            f"· 회차 소요: 평균 {_minutes(facts.average_duration)}, 최장 {_minutes(facts.longest_duration)}"
        )
    else:
        lines.append("· 회차 소요: 끝난 회차 없음")
    lines.append(
        f"· 발행된 공고: {facts.published:,}건 · 발행에서 뺀 공고: {facts.excluded:,}건"
    )
    reconcile = facts.reconcile
    if reconcile is None:
        # 07:00 재대조는 두 보고 기간에 모두 들어 있다. 기간에 없으면 돌지 않은 것이다.
        status = FAIL if status == FAIL else WARN
        lines.append("· 일괄 대조: 이 기간에 돌지 않음")
    else:
        took = (
            f"{_minutes(reconcile.ended_at - reconcile.started_at)} 걸림"
            if reconcile.ended_at is not None
            else "아직 도는 중"
        )
        word = {"published": "성공", "failed": "실패"}.get(
            reconcile.status, reconcile.status
        )
        if reconcile.status == "failed":
            status = FAIL if status == FAIL else WARN
        lines.append(
            f"· 일괄 대조({_clock(reconcile.started_at)}): {word} · 공고 {reconcile.published:,}건 · {took}"
        )
    return status, lines


def _publication(facts: PublicationFacts | Unavailable) -> tuple[str, list[str]]:
    if isinstance(facts, Unavailable):
        return WARN, [f"· {facts}"]
    status = WARN if facts.stale_validated or facts.unresolved_exclusions else OK
    return status, [
        f"· 검사 통과 뒤 멈춘 발행: {facts.stale_validated}건",
        f"· 과거 공고 달 창 완결: {facts.backfill_complete}/{facts.backfill_total}",
        f"· 아직 못 채운 제외 공고: {facts.unresolved_exclusions}건"
        + (f"(창 {facts.unresolved_windows}개)" if facts.unresolved_exclusions else ""),
    ]


def _backend(
    facts: tuple[WorkloadFacts, ...] | Unavailable, slot: ReportSlot
) -> tuple[str, list[str]]:
    if isinstance(facts, Unavailable):
        return WARN, [f"· {facts}"]
    status = OK
    lines: list[str] = []
    for workload in facts:
        http = workload.http_status
        http_ok = isinstance(http, int) and http < 400
        if workload.ready < workload.desired or (isinstance(http, int) and not http_ok):
            status = FAIL
        elif isinstance(http, Unavailable) and status == OK:
            status = WARN
        restarted = (
            workload.last_restart_at is not None
            and workload.last_restart_at >= slot.start
        )
        if restarted and status == OK:
            status = WARN
        restart_note = (
            f", 마지막 재시작 {_clock(workload.last_restart_at)}"
            if workload.last_restart_at is not None
            else ""
        )
        lines.append(
            f"· {workload.name}: 준비 {workload.ready}/{workload.desired}, 재시작 {workload.restarts}회"
            f"{restart_note}, 응답 {http if isinstance(http, int) else str(http)}"
        )
    return status, lines


def _database(facts: DatabaseFacts, now: datetime) -> tuple[str, list[str]]:
    status = OK
    size, volume = facts.size_bytes, facts.volume_bytes
    if isinstance(size, int) and isinstance(volume, int) and volume > 0:
        # 정수 백분율이다. DB 파일만 센 값이라 WAL·임시 파일이 있는 실제 디스크 사용률보다 작다.
        used = size * 100 // volume
        if used >= DISK_WARN_PERCENT:
            status = WARN
        lines = [
            f"· DB 크기: {_size(size)} / 볼륨 {_size(volume)} (약 {used}%, WAL 등 제외)"
        ]
    else:
        status = WARN
        size_text = _size(size) if isinstance(size, int) else str(size)
        volume_text = _size(volume) if isinstance(volume, int) else str(volume)
        lines = [f"· DB 크기: {size_text} / 볼륨 {volume_text}"]
    backup = facts.last_backup_at
    if isinstance(backup, Unavailable):
        status = WARN if status == OK else status
        lines.append(f"· 마지막 백업: {backup}")
    elif backup is None:
        status = FAIL
        lines.append("· 마지막 백업: 없음")
    else:
        if now - backup >= BACKUP_STALE_AFTER:
            status = FAIL
        lines.append(f"· 마지막 백업: {_clock(backup)} ({_minutes(now - backup)} 전)")
    return status, lines


def _deploy(facts: tuple[ApplicationFacts, ...] | Unavailable) -> tuple[str, list[str]]:
    if isinstance(facts, Unavailable):
        return WARN, [f"· {facts}"]
    if not facts:
        return FAIL, ["· Argo CD 앱이 하나도 없음"]
    status = OK
    lines: list[str] = []
    for app in facts:
        if app.sync != "Synced" or app.health not in {"Healthy", "Progressing"}:
            status = FAIL
        elif app.health == "Progressing" and status == OK:
            status = WARN
        revision = f", 커밋 {app.revision[:7]}" if app.revision else ""
        lines.append(f"· {app.name}: {app.sync}·{app.health}{revision}")
        lines.extend(f"  {image}" for image in app.images)
    return status, lines


def _problem_explanation(item: OpenViolation) -> Explanation:
    if item.explanation is not None:
        return item.explanation
    # 이번 회차에 관측하지 못해 표에서 물려받은 위반은 선언의 설명을 들고 오지 않는다. 지어내지 않는다.
    return Explanation(
        what=f"어긋난 기대: {item.title or item.key}",
        impact="확인 못 함 — 이번 회차에 이 항목을 관측하지 못했습니다",
        urgency=urgency_for(item.severity),
    )


def problem_line(item: OpenViolation, now: datetime) -> str:
    explanation = _problem_explanation(item)
    mark = FAIL if item.severity == "critical" else WARN
    unobserved = " (이번엔 확인 못 함)" if item.observation == UNOBSERVED else ""
    return (
        f"{mark} {age_text(parse_instant(item.first_seen_at), now)} · {explanation.what}{unobserved}\n"
        f"   영향: {explanation.impact}\n   급함: {explanation.urgency}"
    )


_PROBLEM_BUDGET = 1800
"""열린 문제 구획에 쓸 글자 수. 나머지 구획이 먼저 자리를 갖고, 넘치는 문제는 "외 N건"으로 접는다 —
문제가 많을수록 구획 보고가 잘려 나가면 "지금 괜찮은가"에 답하지 못한다."""


def section_statuses(report: StatusReport) -> tuple[tuple[str, str, list[str]], ...]:
    """구획마다 (이름, 판정, 문장들). 검사와 조립이 같은 판정을 쓰게 한 자리에 둔다."""
    return (
        ("크롤러", *_crawler(report.crawler, report.now)),
        ("발행", *_publication(report.publication)),
        ("백엔드·웹", *_backend(report.backend, report.slot)),
        ("DB", *_database(report.database, report.now)),
        ("배포", *_deploy(report.deploy)),
    )


def _problems_status(problems: Sequence[OpenViolation]) -> str:
    if any(item.severity == "critical" for item in problems):
        return FAIL
    return WARN if problems else OK


def _problem_block(problems: Sequence[OpenViolation], now: datetime) -> str:
    block = f"{_problems_status(problems)} 열린 문제 {len(problems)}건"
    if not problems:
        return block + " — 없음"
    used = 0
    for index, item in enumerate(problems):
        line = "\n" + problem_line(item, now)
        if used + len(line) > _PROBLEM_BUDGET:
            return (
                block
                + f"\n… 외 {len(problems) - index}건 (monitoring.violation 표에 전부 있음)"
            )
        block += line
        used += len(line)
    return block


def format_status_report(report: StatusReport) -> str:
    """보고 한 통. 전체 한 줄 → 구획 다섯 → 열린 문제 순이며, 전체 줄의 표시는 가장 나쁜 판정을 따른다."""
    problems = sorted(report.problems, key=lambda item: item.first_seen_at)
    sections = section_statuses(report)
    marks = [status for _, status, _ in sections] + [_problems_status(problems)]
    troubled = [name for name, status, _ in sections if status != OK]
    if problems:
        troubled.append("열린 문제")
    worst = FAIL if FAIL in marks else WARN if WARN in marks else OK
    overall = (
        f"{OK} 전체 정상"
        if worst == OK
        else f"{worst} 살펴볼 곳 {len(troubled)}곳: {', '.join(troubled)}"
    )
    slot = report.slot
    header = (
        f"[{report.environment}] {slot.label} 상태 보고 · "
        f"{_clock(slot.start)} ~ {_clock(slot.end)}\n{overall}"
    )
    body = "".join(
        f"\n\n{status} {name} — {_WORDS[status]}\n" + "\n".join(lines)
        for name, status, lines in sections
    )
    return truncate(header + body + "\n\n" + _problem_block(problems, report.now))
