"""모듈 책임: 회차 지표 질의가 실제 스키마에서 돌고 monitoring.round에 한 행이 남는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from psycopg.rows import dict_row

from eatbid.monitoring.round import collect_round_metrics, record_round

from .conftest import MigratedDatabase


def test_빈_스키마에서_한_회차를_돌리면_0으로_채운_행_하나가_남는다(
    migrated_db: MigratedDatabase,
) -> None:
    """질의 넷이 실제 표·view 이름을 맞게 부르는지는 여기서만 드러난다. 단위 검사는 SQL 문자열을
    그대로 믿는다."""
    지금 = datetime(2026, 9, 16, 5, 33, tzinfo=UTC)

    with migrated_db.connect() as connection:

        def run_query(sql: str, parameters: Mapping[str, Any]) -> Sequence[Mapping[str, Any]]:
            with connection.cursor(row_factory=dict_row) as cursor:
                cursor.execute(sql, parameters)
                return list(cursor.fetchall())

        def execute(sql: str, parameters: Mapping[str, Any]) -> None:
            with connection.cursor() as cursor:
                cursor.execute(sql, parameters)
            connection.commit()

        metrics = collect_round_metrics(
            run_query, now=지금, environment="test", violations_open=1, check_duration_ms=7
        )
        record_round(execute, metrics)

        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute("select * from monitoring.round order by observed_at desc")
            rows = cursor.fetchall()

    assert len(rows) == 1
    row = rows[0]
    assert row["environment"] == "test"
    assert row["observed_at"] == 지금
    assert (row["runs_started_1h"], row["runs_failed_1h"]) == ({}, {})
    assert (
        row["auctions_published_1h"],
        row["open_auctions_now"],
        row["backfill_windows_incomplete"],
        row["violations_open"],
        row["check_duration_ms"],
    ) == (0, 0, 0, 1, 7)
