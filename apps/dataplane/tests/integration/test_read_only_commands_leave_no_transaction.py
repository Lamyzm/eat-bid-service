"""실제 PostgreSQL 연결로 읽기 전용 명령이 transaction을 남기지 않는지 고정한다.

왜 통합 시험인가: 이 결함은 psycopg가 연 암묵 transaction의 존재 여부이고, 판정은 실제 연결의
`info.transaction_status`가 한다. 가짜 연결에는 그 상태가 없어 단위 시험이 통과한 채로 운영에서만
깨진다 — 2026-09-18에 `next-replay-target`이 그렇게 CI를 통과하고 배포 뒤 매 회차 실패했다.
"""

from __future__ import annotations

import argparse
from datetime import UTC, date, datetime
from typing import Any

import psycopg
import pytest

from eatbid.composition import Application

from .conftest import MigratedDatabase


class _ClosableHttp:
    """Application이 닫을 때 부르는 표면만 가진 최소 대역이다. 이 시험은 소스를 부르지 않는다."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def _read_only_application(connection: Any) -> Application:
    return Application(connection=connection, http_client=_ClosableHttp())


def _replay_target_args() -> argparse.Namespace:
    return argparse.Namespace(
        build_sha="0" * 40,
        run_id="6f1a3c2e-5b7d-4a91-8c33-2d4e6f8a0b12",
        as_of=datetime(2026, 9, 18, 3, 25, 0, tzinfo=UTC),
    )


def test_재처리_대상_조회는_transaction을_남기지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    connection = migrated_db.connect()
    try:
        application = _read_only_application(connection)
        application.next_replay_target(_replay_target_args())
        assert (
            connection.info.transaction_status is psycopg.pq.TransactionStatus.IDLE
        ), "읽기만 한 뒤에는 열린 transaction이 남아 있으면 안 된다"
    finally:
        if not connection.closed:
            connection.close()


def test_재처리_대상_조회만_하고_닫아도_명령이_실패하지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """운영에서 실제로 난 실패다. decide 단계가 대상을 고른 뒤 close()에서 exit 64로 죽었다."""
    connection = migrated_db.connect()
    application = _read_only_application(connection)
    application.next_replay_target(_replay_target_args())
    # 가드가 걸리면 RuntimeError를 던진다. 이 호출이 조용히 끝나는 것이 이 시험의 전부다.
    application.close()
    assert connection.closed


def test_다음_백필_창_조회도_transaction을_남기지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """같은 결함이 형제 읽기 경로에 다시 생기지 않게 함께 고정한다."""
    connection = migrated_db.connect()
    try:
        application = _read_only_application(connection)
        application.next_backfill_window(
            argparse.Namespace(
                floor_date=date(2021, 9, 1),
                as_of=datetime(2026, 9, 18, 3, 25, 0, tzinfo=UTC),
            )
        )
        assert connection.info.transaction_status is psycopg.pq.TransactionStatus.IDLE
    except AttributeError as error:  # pragma: no cover - 인자 형태가 바뀌면 여기서 드러난다.
        pytest.fail(f"next_backfill_window 인자 계약이 바뀌었다: {error}")
    finally:
        if not connection.closed:
            connection.close()
