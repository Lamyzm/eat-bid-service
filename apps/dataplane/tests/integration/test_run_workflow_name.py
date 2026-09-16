"""모듈 책임: run 행의 workflow_name이 실제 스키마에 남고 진행 기대가 그것으로 R2 로그 접두사를 만드는지 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

from psycopg.rows import dict_row

from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.monitoring.expectations import EXPECTATIONS

from .conftest import MigratedDatabase

BUILD_SHA = "c" * 40


def _진행_기대():
    return next(expectation for expectation in EXPECTATIONS if expectation.key == "backfill-progress")


def test_workflow_이름은_run_행에_남고_없으면_NULL이다(migrated_db: MigratedDatabase) -> None:
    named, unnamed = uuid4(), uuid4()
    with migrated_db.connect() as connection:
        repository = PsycopgObservationRepository(connection)
        repository.start_run(
            run_id=named, mode="poll-open", build_sha=BUILD_SHA, parser_version="eat-v2",
            started_at=datetime.now(UTC), expected_count=1, workflow_name="eatbid-poll-open-1789504380",
        )
        repository.start_run(
            run_id=unnamed, mode="poll-open", build_sha=BUILD_SHA, parser_version="eat-v2",
            started_at=datetime.now(UTC), expected_count=1,
        )
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "select run_id, workflow_name from ingest.run where run_id = any(%s) order by workflow_name nulls last",
                ([named, unnamed],),
            )
            rows = cursor.fetchall()

    assert [(row["run_id"], row["workflow_name"]) for row in rows] == [
        (named, "eatbid-poll-open-1789504380"),
        (unnamed, None),
    ]


def test_멈춘_run의_위반_detail은_R2_로그_접두사를_같이_적는다(migrated_db: MigratedDatabase) -> None:
    """알림을 받은 사람이 run_id로 Workflow 객체를 찾을 필요 없이 로그로 바로 간다. 이름이 없는 옛 run은
    접두사도 없다 — 모르는 것을 지어내지 않는다(AGENTS 3)."""
    stalled = uuid4()
    # KST로는 9월 1일 08:30이지만 Argo가 로그를 놓는 자리는 workflow.creationTimestamp의 UTC 연/월이다.
    # 접두사도 UTC로 만들어야 8월 31일 밤 회차의 로그를 9월 폴더에서 헛찾지 않는다.
    started_at = datetime(2026, 8, 31, 23, 30, tzinfo=UTC)
    assert started_at + timedelta(hours=9) == datetime(2026, 9, 1, 8, 30, tzinfo=UTC)
    expectation = _진행_기대()
    with migrated_db.connect() as connection:
        PsycopgObservationRepository(connection).start_run(
            run_id=stalled, mode="backfill", build_sha=BUILD_SHA, parser_version="eat-v2",
            started_at=started_at, expected_count=1, workflow_name="eatbid-backfill-advance-42",
        )
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(expectation.sql, expectation.parameters)
            rows = {row["run_id"]: row for row in cursor.fetchall()}

    assert rows[str(stalled)]["logs"] == "workflow-logs/2026/08/eatbid-backfill-advance-42/"
