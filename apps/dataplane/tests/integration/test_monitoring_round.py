"""모듈 책임: 회차 지표 질의가 실제 스키마에서 돌고 monitoring.round에 한 행이 남는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from psycopg.rows import dict_row

from eatbid.monitoring.round import collect_round_metrics, record_round

from .conftest import MigratedDatabase


def test_실제_스키마에서_한_회차를_돌리면_센_값_그대로_행_하나가_남는다(
    migrated_db: MigratedDatabase,
) -> None:
    """질의 넷이 실제 표·view 이름을 맞게 부르는지, 그리고 jsonb·시각이 왕복하는지는 여기서만
    드러난다. 단위 검사는 SQL 문자열을 그대로 믿는다."""
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
            cursor.execute(
                "select * from monitoring.round where environment = 'test' order by observed_at desc"
            )
            rows = cursor.fetchall()
            # migrated_db는 세션 하나를 여러 통합 검사가 나눠 쓴다. 앞선 검사가 남긴 백필 창이 있을 수
            # 있으므로 "0"이 아니라 같은 view를 직접 센 값과 견준다(CI에서 1이었다).
            cursor.execute("select count(*) as n from ingest.backfill_coverage where not is_complete")
            incomplete = cursor.fetchone()["n"]  # type: ignore[index]

    assert len(rows) == 1
    row = rows[0]
    assert (row["environment"], row["observed_at"]) == ("test", 지금)
    assert (row["runs_started_1h"], row["runs_failed_1h"]) == (
        dict(metrics.runs_started_1h),
        dict(metrics.runs_failed_1h),
    )
    assert (
        row["auctions_published_1h"],
        row["open_auctions_now"],
        row["backfill_windows_incomplete"],
        row["violations_open"],
        row["check_duration_ms"],
    ) == (
        metrics.auctions_published_1h,
        metrics.open_auctions_now,
        metrics.backfill_windows_incomplete,
        1,
        7,
    )
    assert metrics.backfill_windows_incomplete == incomplete
