"""모듈 책임: 감시 회차 끝에 남기는 모양 지표 `monitoring.round`의 질의·조립·쓰기를 소유한다.

알림의 근거가 아니라 사람이 보는 선이다(ADR 0046 결정 4). 기대(expectations)는 판정하고 이 모듈은
세기만 한다 — 둘을 한 모듈에 두면 "지표가 나쁘면 울린다"는 유혹이 생긴다.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

QueryRunner = Callable[[str, Mapping[str, Any]], Sequence[Mapping[str, Any]]]
Executor = Callable[[str, Mapping[str, Any]], None]


@dataclass(frozen=True)
class RoundMetrics:
    observed_at: datetime
    environment: str
    runs_started_1h: Mapping[str, int]
    runs_failed_1h: Mapping[str, int]
    auctions_published_1h: int
    open_auctions_now: int
    backfill_windows_incomplete: int
    violations_open: int
    check_duration_ms: int


# 최근 한 시간에 시작된 run을 mode별로 센다. 창을 파라미터로 받는 이유는 회차 시각을 고정해 검사할 수
# 있게 하려는 것이며, `now()`를 SQL에 두면 통합 검사가 시각을 통제하지 못한다.
RUNS_SQL = """
    select mode,
           count(*) as started,
           count(*) filter (where status = 'failed') as failed
      from ingest.run
     where started_at >= %(since)s
     group by mode
"""

# 발행된 revision의 시각은 그 근거 관측이 들어온 시각이다. revision 자체에는 시각 열이 없다.
PUBLISHED_SQL = """
    select count(*) as published
      from core.auction_revision rev
      join ingest.raw_observation o on o.observation_id = rev.observation_id
     where o.fetched_at >= %(since)s
"""

# 활성 build의 스냅샷 가운데 아직 마감이 지나지 않은 것. 마감 시각을 모르는 행은 열린 것으로 센다.
OPEN_SQL = """
    select count(*) as open_now
      from mart.open_auction_snapshot s
      join mart.build b on b.build_id = s.build_id
     where b.status = 'active'
       and (s.closes_at is null or s.closes_at > %(now)s)
"""

BACKFILL_SQL = """
    select count(*) as incomplete
      from ingest.backfill_coverage
     where not is_complete
"""

INSERT_SQL = """
    insert into monitoring.round (
        observed_at, environment, runs_started_1h, runs_failed_1h,
        auctions_published_1h, open_auctions_now, backfill_windows_incomplete,
        violations_open, check_duration_ms
    ) values (
        %(observed_at)s, %(environment)s, %(runs_started_1h)s::jsonb, %(runs_failed_1h)s::jsonb,
        %(auctions_published_1h)s, %(open_auctions_now)s, %(backfill_windows_incomplete)s,
        %(violations_open)s, %(check_duration_ms)s
    )
"""


def _scalar(rows: Sequence[Mapping[str, Any]], column: str) -> int:
    """집계 질의가 행을 내지 않으면 표본이 없다는 뜻이고 그것은 0이지 NULL이 아니다."""
    if not rows:
        return 0
    value = rows[0].get(column)
    return int(value) if value is not None else 0


def collect_round_metrics(
    run_query: QueryRunner,
    *,
    now: datetime,
    environment: str,
    violations_open: int,
    check_duration_ms: int,
) -> RoundMetrics:
    since = now - timedelta(hours=1)
    started: dict[str, int] = {}
    failed: dict[str, int] = {}
    for row in run_query(RUNS_SQL, {"since": since}):
        mode = str(row["mode"])
        started[mode] = int(row["started"])
        failed[mode] = int(row["failed"])
    return RoundMetrics(
        observed_at=now,
        environment=environment,
        runs_started_1h=started,
        runs_failed_1h=failed,
        auctions_published_1h=_scalar(run_query(PUBLISHED_SQL, {"since": since}), "published"),
        open_auctions_now=_scalar(run_query(OPEN_SQL, {"now": now}), "open_now"),
        backfill_windows_incomplete=_scalar(run_query(BACKFILL_SQL, {}), "incomplete"),
        violations_open=violations_open,
        check_duration_ms=check_duration_ms,
    )


def record_round(execute: Executor, metrics: RoundMetrics) -> None:
    """한 행을 쓴다. 실패는 예외로 올린다 — 회차가 끝까지 끝나야 심장박동이 나가므로, 쓰지 못한
    회차는 바깥에서 신호 끊김으로 보인다. 그것이 의도다."""
    execute(
        INSERT_SQL,
        {
            "observed_at": metrics.observed_at,
            "environment": metrics.environment,
            "runs_started_1h": json.dumps(dict(metrics.runs_started_1h), sort_keys=True),
            "runs_failed_1h": json.dumps(dict(metrics.runs_failed_1h), sort_keys=True),
            "auctions_published_1h": metrics.auctions_published_1h,
            "open_auctions_now": metrics.open_auctions_now,
            "backfill_windows_incomplete": metrics.backfill_windows_incomplete,
            "violations_open": metrics.violations_open,
            "check_duration_ms": metrics.check_duration_ms,
        },
    )
