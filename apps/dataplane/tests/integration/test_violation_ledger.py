"""모듈 책임: 위반 원장이 실제 PostgreSQL에서 열림·관측·해소·재알림·이관을 표 규칙대로 적는지 고정한다."""

from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from typing import Any

from psycopg.rows import dict_row

from eatbid.monitoring.expectations import Violation
from eatbid.monitoring.ledger import PostgresViolationLedger
from eatbid.monitoring.state import OpenViolation, diff_violations

from .conftest import MigratedDatabase


def _원장(connection: Any, environment: str = "test") -> PostgresViolationLedger:
    def query(sql: str, parameters: Mapping[str, Any]):
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, parameters)
            return list(cursor.fetchall())

    def mutate(sql: str, parameters: Mapping[str, Any]):
        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(sql, parameters)
            rows = list(cursor.fetchall()) if cursor.description else []
        connection.commit()
        return rows

    return PostgresViolationLedger(query=query, mutate=mutate, environment=environment)


def test_열린_위반은_한_행으로_살다가_해소_시각을_얻고_지워지지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    t0 = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        # 환경 이름으로 다른 테스트와 격리한다. 표는 한 DB에 한 번 만들어지고 테스트들이 함께 쓴다.
        원장 = _원장(connection, environment="t-lifecycle")
        assert 원장.is_empty()

        열림 = diff_violations(
            [
                Violation(
                    key="probe:r1",
                    title="t",
                    runbook="docs/x.md",
                    detail="d",
                    severity="critical",
                )
            ],
            원장.read_open(),
            now=t0.isoformat(),
        )
        적용 = 원장.apply(열림, now=t0)
        [열린_id] = [item.violation_id for item in 적용.still_open]
        assert 열린_id is not None

        다시 = 원장.read_open()
        assert [(item.key, item.severity, item.observation) for item in 다시] == [
            ("probe:r1", "critical", "observed")
        ]
        원장.mark_notified([열린_id], at=t0)
        assert 원장.read_open()[0].last_notified_at is not None

        해소 = diff_violations(
            [], 원장.read_open(), now=(t0 + timedelta(hours=1)).isoformat()
        )
        적용2 = 원장.apply(해소, now=t0 + timedelta(hours=1))
        assert 적용2.resolved_ids == {"probe:r1": 열린_id}
        assert 원장.read_open() == ()

        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "select resolved_at, first_seen_at from monitoring.violation"
                " where environment = 't-lifecycle'"
            )
            행 = cursor.fetchall()
        assert len(행) == 1 and 행[0]["resolved_at"] is not None


def test_같은_키가_다시_열리면_새_행이고_이전_이력은_남는다(
    migrated_db: MigratedDatabase,
) -> None:
    t0 = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        원장 = _원장(connection, environment="t-reopen")
        v = Violation(key="probe", title="t", runbook="docs/x.md", detail="d")
        원장.apply(diff_violations([v], 원장.read_open(), now=t0.isoformat()), now=t0)
        원장.apply(
            diff_violations([], 원장.read_open(), now=t0.isoformat()),
            now=t0 + timedelta(minutes=15),
        )
        원장.apply(
            diff_violations([v], 원장.read_open(), now=t0.isoformat()),
            now=t0 + timedelta(minutes=30),
        )

        with connection.cursor() as cursor:
            cursor.execute(
                "select count(*), count(resolved_at) from monitoring.violation"
                " where environment = 't-reopen'"
            )
            전체, 해소됨 = cursor.fetchone()
        assert (전체, 해소됨) == (2, 1)


def test_관측_안_된_회차는_행을_갱신하지_않고_표시만_남긴다(
    migrated_db: MigratedDatabase,
) -> None:
    t0 = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        원장 = _원장(connection, environment="t-unobserved")
        v = Violation(key="probe:r1", title="t", runbook="docs/x.md", detail="d")
        원장.apply(diff_violations([v], (), now=t0.isoformat()), now=t0)

        실패 = diff_violations(
            [
                Violation(
                    key="probe:check-failed", title="f", runbook="docs/x.md", detail="e"
                )
            ],
            원장.read_open(),
            now=(t0 + timedelta(minutes=15)).isoformat(),
        )
        원장.apply(실패, now=t0 + timedelta(minutes=15))

        with connection.cursor(row_factory=dict_row) as cursor:
            cursor.execute(
                "select violation_key, observation, last_seen_at from monitoring.violation"
                " where environment = 't-unobserved' and resolved_at is null"
                " order by violation_key"
            )
            행들 = cursor.fetchall()
        by_key = {row["violation_key"]: row for row in 행들}
        assert by_key["probe:r1"]["observation"] == "unobserved"
        assert by_key["probe:r1"]["last_seen_at"] == t0
        assert by_key["probe:check-failed"]["observation"] == "observed"


def test_알림_행은_통마다_위반마다_남고_요약은_위반_없이_남는다(
    migrated_db: MigratedDatabase,
) -> None:
    t0 = datetime(2026, 9, 16, 0, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        원장 = _원장(connection, environment="t-notify")
        적용 = 원장.apply(
            diff_violations(
                [
                    Violation(key="a", title="t", runbook="docs/x.md", detail="d"),
                    Violation(key="b", title="t", runbook="docs/x.md", detail="d"),
                ],
                (),
                now=t0.isoformat(),
            ),
            now=t0,
        )
        ids = [item.violation_id for item in 적용.still_open]
        원장.record_notification(
            kind="opened", violation_ids=ids, sent_at=t0, ok=True, error=None
        )
        원장.record_notification(
            kind="digest", violation_ids=(), sent_at=t0, ok=True, error=None
        )
        원장.record_notification(
            kind="repeat", violation_ids=ids[:1], sent_at=t0, ok=False, error="503"
        )

        assert 원장.digest_sent_since(t0) is True
        assert 원장.digest_sent_since(t0 + timedelta(seconds=1)) is False
        with connection.cursor() as cursor:
            cursor.execute(
                "select kind, violation_id is null, ok from monitoring.notification"
                " where environment = 't-notify' order by notification_id"
            )
            assert cursor.fetchall() == [
                ("opened", False, True),
                ("opened", False, True),
                ("digest", True, True),
                ("repeat", False, False),
            ]


def test_R2_문서의_열린_위반은_처음_본_시각만_옮기고_그_시각을_첫_알림으로_둔다(
    migrated_db: MigratedDatabase,
) -> None:
    with migrated_db.connect() as connection:
        원장 = _원장(connection, environment="prod")
        옮긴수 = 원장.import_open(
            [
                OpenViolation(
                    key="backfill-progress:86b99ee7",
                    first_seen_at="2026-09-15T20:33:10.506830+00:00",
                    title="실행 중인 backfill이 진행하고 있다",
                    detail="run_id=86b99ee7",
                    runbook="docs/operations/collection-runbook.md",
                )
            ],
            now=datetime(2026, 9, 16, 12, 0, tzinfo=UTC),
        )

        assert 옮긴수 == 1
        열린 = 원장.read_open()
        assert 열린[0].first_seen_at.startswith("2026-09-15T20:33:10")
        assert 열린[0].last_notified_at == 열린[0].first_seen_at
        assert 열린[0].expectation_key == "backfill-progress"
        assert not 원장.is_empty()
