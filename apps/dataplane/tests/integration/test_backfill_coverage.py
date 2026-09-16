"""모듈 책임: 전진 판단이 읽는 backfill_coverage view의 열 넷이 실제 스키마에 있고 빈 표에서도 도는지 고정한다."""

from __future__ import annotations

from psycopg.rows import dict_row

from .conftest import MigratedDatabase

# composition.next_backfill_window가 실행하는 문장 그대로다. view가 열을 바꾸면 여기서 먼저 깨져야 한다.
ADVANCE_SQL = (
    "select window_start, window_end, is_complete, failed_publications from ingest.backfill_coverage"
)


def test_전진이_읽는_coverage_열_넷이_빈_스키마에서도_돈다(migrated_db: MigratedDatabase) -> None:
    with migrated_db.connect() as connection, connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(ADVANCE_SQL)
        columns = [description.name for description in cursor.description or ()]
        rows = cursor.fetchall()

    assert columns == ["window_start", "window_end", "is_complete", "failed_publications"]
    # 실패한 발행이 없는 창은 0이지 NULL이 아니다 — 전진이 int()로 읽는다.
    assert all(row["failed_publications"] >= 0 for row in rows)
