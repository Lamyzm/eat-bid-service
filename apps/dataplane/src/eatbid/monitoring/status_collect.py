"""모듈 책임: 상태 보고에 들어갈 사실을 DB 질의·백업 목록·클러스터 조회(status_cluster)에서 모아 한 통으로 묶고, 못 모은 것은 `Unavailable`로 남긴다.

왜 원천마다 따로 감싸는가: 한쪽 권한이 빠지거나 한 질의가 깨져도 나머지 구획은 보고돼야 한다. 배포 상태를
못 읽었다고 크롤러 구획까지 모르는 상태가 되면 안 된다(cluster.evaluate_cluster와 같은 규칙).

왜 I/O를 주입받는가: 질의·조회는 조립부(composition)가 넣고, 이 모듈은 무엇을 묻고 그 답을 어떤 사실로 옮길지만
안다. 기존 감시 모듈(round, cluster, backup)과 같은 방식이다.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from .cluster import ResourceLister
from .expectations import EXPECTATIONS, MONTH_WINDOW_PREDICATE, QueryRunner
from .report_schedule import ReportSlot, planned_poll_open_ticks
from .state import OpenViolation
from .status_cluster import (
    HttpProbe,
    collect_applications,
    collect_workloads,
    database_volume_bytes,
)
from .status_facts import (
    CrawlerFacts,
    DatabaseFacts,
    PublicationFacts,
    ReconcileFacts,
    StatusReport,
    Unavailable,
    attempt,
)

NewestBackup = Callable[[], datetime | None]
"""가장 최근 백업 객체의 시각. 객체가 하나도 없으면 None이다."""

CRAWLER_RUNS_SQL = """
    select count(*) as started,
           count(*) filter (where status = 'published') as succeeded,
           count(*) filter (where status = 'failed') as failed,
           count(*) filter (where ended_at is null) as running,
           coalesce(sum(published_count) filter (where status = 'published'), 0) as published,
           avg(ended_at - started_at) filter (where ended_at is not null) as average_duration,
           max(ended_at - started_at) filter (where ended_at is not null) as longest_duration
      from ingest.run
     where mode = 'poll-open' and started_at >= %(start)s and started_at < %(end)s
"""

LAST_SUCCESS_SQL = """
    select max(ended_at) as last_success_at
      from ingest.run
     where mode = 'poll-open' and status = 'published'
"""

# 제외는 mode를 가리지 않고 기간 안에 원장에 적힌 것을 전부 센다. 재대조·replay가 뺀 공고도 화면에서 빠진 같은
# 구멍이라, 정시 수집 것만 세면 보고가 구멍을 작게 말한다.
EXCLUDED_SQL = """
    select count(*) as excluded
      from ingest.publication_exclusion
     where created_at >= %(start)s and created_at < %(end)s
"""

RECONCILE_SQL = """
    select status, started_at, ended_at, published_count
      from ingest.run
     where mode = 'daily-reconcile' and started_at >= %(start)s and started_at < %(end)s
     order by started_at desc
     limit 1
"""

# 달 전체 창만 완결을 센다 — 전진이 보는 창이 그것뿐이다(expectations.MONTH_WINDOW_PREDICATE). 미해소 제외는
# 하루 창의 것도 같은 구멍이라 전부 센다(unresolved-exclusion 기대와 같은 범위).
BACKFILL_SQL = f"""
    select count(*) filter (where is_complete and ({MONTH_WINDOW_PREDICATE})) as complete,
           count(*) filter (where {MONTH_WINDOW_PREDICATE}) as total,
           coalesce(sum(unresolved_exclusions), 0) as unresolved,
           count(*) filter (where unresolved_exclusions > 0) as unresolved_windows
      from ingest.backfill_coverage
"""

DATABASE_SIZE_SQL = "select pg_database_size(current_database()) as size_bytes"


@dataclass(frozen=True)
class StatusSources:
    """DB 밖의 원천. 없는 원천은 None이고, 그 구획은 "확인 못 함"이 된다 — 없는 것을 정상으로 읽지 않는다."""

    list_resources: ResourceLister | None = None
    probe_http: HttpProbe | None = None
    newest_backup: NewestBackup | None = None


def _int(row: Mapping[str, Any], column: str) -> int:
    value = row.get(column)
    return int(value) if value is not None else 0


def _one(rows: Sequence[Mapping[str, Any]]) -> Mapping[str, Any]:
    return rows[0] if rows else {}


def _crawler(run_query: QueryRunner, slot: ReportSlot) -> CrawlerFacts:
    window = {"start": slot.start, "end": slot.end}
    runs = _one(run_query(CRAWLER_RUNS_SQL, window))
    last = _one(run_query(LAST_SUCCESS_SQL, {})).get("last_success_at")
    reconcile_rows = run_query(RECONCILE_SQL, window)
    reconcile = None
    if reconcile_rows:
        row = reconcile_rows[0]
        reconcile = ReconcileFacts(
            status=str(row["status"]),
            started_at=row["started_at"],
            ended_at=row.get("ended_at"),
            published=_int(row, "published_count"),
        )
    return CrawlerFacts(
        planned=planned_poll_open_ticks(slot.start, slot.end),
        started=_int(runs, "started"),
        succeeded=_int(runs, "succeeded"),
        failed=_int(runs, "failed"),
        running=_int(runs, "running"),
        published=_int(runs, "published"),
        excluded=_int(_one(run_query(EXCLUDED_SQL, window)), "excluded"),
        last_success_at=last if isinstance(last, datetime) else None,
        average_duration=_span(runs.get("average_duration")),
        longest_duration=_span(runs.get("longest_duration")),
        reconcile=reconcile,
    )


def _span(value: object) -> timedelta | None:
    return value if isinstance(value, timedelta) else None


def _publication(run_query: QueryRunner) -> PublicationFacts:
    # 멈춘 발행 수는 알림과 같은 질의로 센다. 보고가 0이라 말하는데 알림이 열려 있는 날이 없게 한다.
    stale = next(
        item for item in EXPECTATIONS if item.key == "stale-validated-publication"
    )
    coverage = _one(run_query(BACKFILL_SQL, {}))
    return PublicationFacts(
        stale_validated=len(run_query(stale.sql, stale.parameters)),
        backfill_complete=_int(coverage, "complete"),
        backfill_total=_int(coverage, "total"),
        unresolved_exclusions=_int(coverage, "unresolved"),
        unresolved_windows=_int(coverage, "unresolved_windows"),
    )


NO_CLUSTER = Unavailable("클러스터 조회 수단 없음")


def _from_cluster[T](
    sources: StatusSources, read: Callable[[ResourceLister], T]
) -> T | Unavailable:
    lister = sources.list_resources
    if lister is None:
        return NO_CLUSTER
    return attempt(lambda: read(lister))


def _database(run_query: QueryRunner, sources: StatusSources) -> DatabaseFacts:
    newest = sources.newest_backup
    return DatabaseFacts(
        size_bytes=attempt(
            lambda: _int(_one(run_query(DATABASE_SIZE_SQL, {})), "size_bytes")
        ),
        volume_bytes=_from_cluster(sources, database_volume_bytes),
        last_backup_at=(
            attempt(newest)
            if newest is not None
            else Unavailable("백업 조회 수단 없음")
        ),
    )


def collect_status_report(
    *,
    environment: str,
    slot: ReportSlot,
    now: datetime,
    run_query: QueryRunner,
    sources: StatusSources,
    problems: Sequence[OpenViolation],
) -> StatusReport:
    return StatusReport(
        environment=environment,
        slot=slot,
        now=now,
        crawler=attempt(lambda: _crawler(run_query, slot)),
        publication=attempt(lambda: _publication(run_query)),
        backend=_from_cluster(
            sources, lambda lister: collect_workloads(lister, sources.probe_http)
        ),
        database=_database(run_query, sources),
        deploy=_from_cluster(sources, collect_applications),
        problems=tuple(problems),
    )
