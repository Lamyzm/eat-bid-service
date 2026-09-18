"""저장되지 않은 채 끝나는 명령이 성공으로 끝나지 않는지 실제 PostgreSQL에서 고정한다(EAT-273).

왜 통합 시험인가: psycopg가 열린 transaction을 조용히 되돌리는 것은 실제 연결의 동작이라 가짜로는
재현되지 않는다. 2026-09-17에 정시 수집이 22시간 멈추는 동안 모든 단계가 exit 0이었고, 그 조용함이
사고를 길게 만들었다.
"""

from __future__ import annotations

import psycopg
import pytest

from eatbid.composition import Application

from .conftest import MigratedDatabase


class _닫히는클라이언트:
    """Application이 닫을 대상만 흉내 낸다. 이 시험은 HTTP를 쓰지 않는다."""

    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


def test_저장되지_않은_transaction을_남기고_끝나면_실패로_끝난다(
    migrated_db: MigratedDatabase,
) -> None:
    with migrated_db.connect() as connection:
        with connection.cursor() as cursor:
            # 읽기 하나로도 psycopg는 암묵 transaction을 연다. 2026-09-17 사고의 출발점이 이것이었다.
            cursor.execute("select 1")
        assert (
            connection.info.transaction_status is not psycopg.pq.TransactionStatus.IDLE
        )
        application = Application.for_test(
            connection=connection, http_client=_닫히는클라이언트()
        )

        with pytest.raises(RuntimeError, match="uncommitted"):
            application.close()


def test_transaction이_닫혀_있으면_조용히_끝난다(
    migrated_db: MigratedDatabase,
) -> None:
    """대조군. 정상 경로가 이 검사 때문에 실패하면 안 된다."""
    with migrated_db.connect() as connection:
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute("select 1")
        assert connection.info.transaction_status is psycopg.pq.TransactionStatus.IDLE
        클라이언트 = _닫히는클라이언트()
        application = Application.for_test(
            connection=connection, http_client=클라이언트
        )

        application.close()

        assert 클라이언트.closed is True
