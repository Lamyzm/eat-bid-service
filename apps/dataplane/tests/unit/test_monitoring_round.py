"""모듈 책임: 회차 지표 조립이 열 아홉을 전부 채우고 표본 0을 NULL이 아닌 0으로 남기는지 고정한다."""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import fields
from datetime import UTC, datetime, timedelta
from typing import Any

from eatbid.monitoring.round import (
    BACKFILL_SQL,
    OPEN_SQL,
    PUBLISHED_SQL,
    RUNS_SQL,
    RoundMetrics,
    collect_round_metrics,
    record_round,
)

지금 = datetime(2026, 9, 16, 5, 33, tzinfo=UTC)


def _질의(answers: Mapping[str, Sequence[Mapping[str, Any]]]):
    asked: list[tuple[str, Mapping[str, Any]]] = []

    def run_query(sql: str, parameters: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
        asked.append((sql, parameters))
        return answers.get(sql, ())

    return run_query, asked


def test_표본이_없는_회차는_0과_빈_객체로_남는다() -> None:
    run_query, _ = _질의({})

    metrics = collect_round_metrics(
        run_query, now=지금, environment="prod", violations_open=0, check_duration_ms=12
    )

    assert metrics == RoundMetrics(
        observed_at=지금,
        environment="prod",
        runs_started_1h={},
        runs_failed_1h={},
        auctions_published_1h=0,
        open_auctions_now=0,
        backfill_windows_incomplete=0,
        violations_open=0,
        check_duration_ms=12,
    )
    assert all(getattr(metrics, field.name) is not None for field in fields(metrics))


def test_mode별_시작_수와_실패_수를_같은_키로_나란히_센다() -> None:
    run_query, asked = _질의(
        {
            RUNS_SQL: [
                {"mode": "poll-open", "started": 6, "failed": 0},
                {"mode": "backfill", "started": 1, "failed": 1},
            ],
            PUBLISHED_SQL: [{"published": 117}],
            OPEN_SQL: [{"open_now": 42}],
            BACKFILL_SQL: [{"incomplete": 9}],
        }
    )

    metrics = collect_round_metrics(
        run_query, now=지금, environment="prod", violations_open=2, check_duration_ms=340
    )

    assert metrics.runs_started_1h == {"poll-open": 6, "backfill": 1}
    assert metrics.runs_failed_1h == {"poll-open": 0, "backfill": 1}
    assert (metrics.auctions_published_1h, metrics.open_auctions_now) == (117, 42)
    assert (metrics.backfill_windows_incomplete, metrics.violations_open) == (9, 2)
    # 한 시간 창은 회차 시각에서 계산한다. SQL의 now()에 맡기면 검사가 시각을 통제하지 못한다.
    assert asked[0][1] == {"since": 지금 - timedelta(hours=1)}
    assert asked[2][1] == {"now": 지금}


def test_행_쓰기는_jsonb_열을_정렬된_JSON_문자열로_넘긴다() -> None:
    executed: list[tuple[str, Mapping[str, Any]]] = []
    metrics = RoundMetrics(
        observed_at=지금,
        environment="prod",
        runs_started_1h={"poll-open": 6, "backfill": 1},
        runs_failed_1h={"poll-open": 0, "backfill": 1},
        auctions_published_1h=117,
        open_auctions_now=42,
        backfill_windows_incomplete=9,
        violations_open=2,
        check_duration_ms=340,
    )

    record_round(lambda sql, parameters: executed.append((sql, parameters)), metrics)

    sql, parameters = executed[0]
    assert "insert into monitoring.round" in sql
    assert json.loads(parameters["runs_started_1h"]) == {"backfill": 1, "poll-open": 6}
    # 키를 정렬해 넣는다. 같은 값이 다른 문자열로 남으면 사람이 두 회차를 눈으로 비교할 수 없다.
    assert parameters["runs_started_1h"] == '{"backfill": 1, "poll-open": 6}'
    assert set(parameters) == {
        "observed_at",
        "environment",
        "runs_started_1h",
        "runs_failed_1h",
        "auctions_published_1h",
        "open_auctions_now",
        "backfill_windows_incomplete",
        "violations_open",
        "check_duration_ms",
    }
