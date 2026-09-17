"""모듈 책임: 소스 보류 저장소가 실제 PostgreSQL에서 보류를 적고, 열린 보류만 돌려주며, 길이가 지수로 느는지 고정한다."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import psycopg

from eatbid.ingest.postgres_hold_repository import PsycopgSourceHoldRepository

from .conftest import MigratedDatabase


def test_차단을_보면_보류가_생기고_열린_보류만_읽히며_지난_하루의_수만큼_길어진다(
    migrated_db: MigratedDatabase,
) -> None:
    t0 = datetime(2026, 9, 16, 12, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        저장소 = PsycopgSourceHoldRepository(connection)
        assert 저장소.open_hold("eat-test", now=t0) is None

        run = uuid4()
        첫째 = 저장소.record_throttle(
            source="eat-test", run_id=run, detail="HTTP 429 on bid-detail", now=t0
        )
        assert 첫째.release_after == t0 + timedelta(minutes=15)
        assert 첫째.held_by_run_id == run

        열린 = 저장소.open_hold("eat-test", now=t0 + timedelta(minutes=1))
        assert 열린 is not None and 열린.hold_id == 첫째.hold_id
        assert 저장소.open_hold("eat-test", now=t0 + timedelta(minutes=16)) is None

        둘째 = 저장소.record_throttle(
            source="eat-test",
            run_id=None,
            detail="HTTP 403 on bid-list",
            now=t0 + timedelta(minutes=20),
        )
        assert 둘째.release_after == t0 + timedelta(minutes=50)

        # 하루가 지나면 다시 15분부터다. 어제의 차단이 오늘의 보류를 길게 만들지 않는다.
        셋째 = 저장소.record_throttle(
            source="eat-test",
            run_id=None,
            detail="HTTP 429",
            now=t0 + timedelta(hours=25),
        )
        assert 셋째.release_after == t0 + timedelta(hours=25, minutes=15)

        # 다른 소스의 보류는 이 소스를 막지 않는다.
        assert 저장소.open_hold("other", now=t0 + timedelta(minutes=1)) is None


def test_보류_조회는_transaction을_남기지_않아_뒤따르는_쓰기가_스스로_커밋된다(
    migrated_db: MigratedDatabase,
) -> None:
    """왜: 이 조회는 정시 수집이 소스를 부르기 전 첫 DB 접근이다. 여기서 연 암묵 transaction이 남으면
    뒤따르는 discover의 쓰기가 전부 savepoint가 되어 프로세스 종료 때 되돌아간다. 단계는 성공으로
    끝나고 행만 사라지므로 어떤 실패 신호도 남지 않는다(2026-09-17 정시 수집 21시간 중단, EAT-264)."""
    now = datetime(2026, 9, 17, 8, 0, tzinfo=UTC)
    with migrated_db.connect() as connection:
        저장소 = PsycopgSourceHoldRepository(connection)

        저장소.open_hold("eat-idle", now=now)

        assert connection.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
        # 열린 보류가 있어도 마찬가지다 — 행을 돌려주는 경로도 블록 안에서 끝나야 한다.
        저장소.record_throttle(
            source="eat-idle", run_id=None, detail="HTTP 429", now=now
        )
        저장소.open_hold("eat-idle", now=now + timedelta(minutes=1))

        assert connection.info.transaction_status == psycopg.pq.TransactionStatus.IDLE
