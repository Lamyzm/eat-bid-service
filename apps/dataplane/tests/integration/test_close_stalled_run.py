"""실제 PostgreSQL로 멈춘 run 닫기의 거부 조건과 결과를 고정한다.

왜 통합 시험인가: 이 함수의 판정 대부분이 SQL 안에 있다. "아직 전진하고 있다"는 관측 시각과 `now()`의
비교이고 "열려 있지 않다"는 `update ... where status = 'running'`의 rowcount다. 가짜 커서로는 둘 다
검증되지 않는다.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg
import pytest

from eatbid.ingest.postgres_run_closure import StalledRunCloseError, close_stalled_run

from .conftest import MigratedDatabase

STALL_AFTER = "90 minutes"


def _insert_run(
    connection: psycopg.Connection[tuple[object, ...]],
    *,
    started_at: datetime,
    status: str = "running",
) -> str:
    # 종료 상태는 끝난 시각을 함께 요구한다(run_terminal_metadata). 열린 run만 비워 둘 수 있다.
    ended_at = None if status == "running" else started_at + timedelta(minutes=1)
    run_id = str(uuid4())
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.run
                   (run_id, mode, status, build_sha, parser_version, started_at,
                    expected_count, captured_count, published_count, ended_at)
            values (%s, 'backfill', %s, %s, 'eat-v5', %s, 0, 0, 0, %s)
            """,
            (run_id, status, "0" * 40, started_at, ended_at),
        )
    return run_id


def test_전진이_멎은_run을_실패로_닫는다(migrated_db: MigratedDatabase) -> None:
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(connection, started_at=datetime.now(UTC) - timedelta(hours=5))
        with connection.transaction(), connection.cursor() as cursor:
            mode = close_stalled_run(
                cursor,
                run_id=run_id,
                outcome="failed",
                ended_at=datetime.now(UTC),
                failure_category="INTERRUPTED",
                stall_after=STALL_AFTER,
            )
        assert mode == "backfill"
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, failure_category from ingest.run where run_id = %s", (run_id,)
            )
            assert cursor.fetchone() == ("failed", "INTERRUPTED")
    finally:
        connection.close()


def test_일이_실제로_끝난_run은_성공으로_닫을_수_있다(migrated_db: MigratedDatabase) -> None:
    """멎은 run이 전부 실패인 것은 아니다. 닫는 코드가 없던 시절의 유물은 일이 끝난 뒤 남은 것이다."""
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(connection, started_at=datetime.now(UTC) - timedelta(days=3))
        with connection.transaction(), connection.cursor() as cursor:
            close_stalled_run(
                cursor,
                run_id=run_id,
                outcome="published",
                ended_at=datetime.now(UTC),
                failure_category=None,
                stall_after=STALL_AFTER,
            )
        with connection.cursor() as cursor:
            cursor.execute(
                "select status, failure_category from ingest.run where run_id = %s", (run_id,)
            )
            assert cursor.fetchone() == ("published", None)
    finally:
        connection.close()


def test_아직_전진하는_run은_닫지_않는다(migrated_db: MigratedDatabase) -> None:
    """기대가 멎음을 판정한 뒤 되살아난 run을 운영자가 죽이지 못하게 닫는 순간 한 번 더 본다."""
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(connection, started_at=datetime.now(UTC) - timedelta(minutes=5))
        with pytest.raises(StalledRunCloseError, match="전진"):
            with connection.transaction(), connection.cursor() as cursor:
                close_stalled_run(
                    cursor,
                    run_id=run_id,
                    outcome="failed",
                    ended_at=datetime.now(UTC),
                    failure_category="INTERRUPTED",
                    stall_after=STALL_AFTER,
                )
    finally:
        connection.close()


def test_이미_닫힌_run은_다시_닫지_않는다(migrated_db: MigratedDatabase) -> None:
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(
            connection, started_at=datetime.now(UTC) - timedelta(days=1), status="published"
        )
        with pytest.raises(StalledRunCloseError):
            with connection.transaction(), connection.cursor() as cursor:
                close_stalled_run(
                    cursor,
                    run_id=run_id,
                    outcome="failed",
                    ended_at=datetime.now(UTC),
                    failure_category="INTERRUPTED",
                    stall_after=STALL_AFTER,
                )
    finally:
        connection.close()


def test_실패로_닫으면서_사유를_비우면_거부한다(migrated_db: MigratedDatabase) -> None:
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(connection, started_at=datetime.now(UTC) - timedelta(days=1))
        with pytest.raises(StalledRunCloseError, match="failure_category"):
            with connection.transaction(), connection.cursor() as cursor:
                close_stalled_run(
                    cursor,
                    run_id=run_id,
                    outcome="failed",
                    ended_at=datetime.now(UTC),
                    failure_category=None,
                    stall_after=STALL_AFTER,
                )
    finally:
        connection.close()


def test_성공으로_닫으면서_사유를_적으면_거부한다(migrated_db: MigratedDatabase) -> None:
    """성공에 실패 사유를 붙이면 그 표를 세는 사람이 무엇이 실제로 끝났는지 못 가린다."""
    connection = migrated_db.connect()
    try:
        run_id = _insert_run(connection, started_at=datetime.now(UTC) - timedelta(days=1))
        with pytest.raises(StalledRunCloseError, match="failure_category"):
            with connection.transaction(), connection.cursor() as cursor:
                close_stalled_run(
                    cursor,
                    run_id=run_id,
                    outcome="published",
                    ended_at=datetime.now(UTC),
                    failure_category="INTERRUPTED",
                    stall_after=STALL_AFTER,
                )
    finally:
        connection.close()
