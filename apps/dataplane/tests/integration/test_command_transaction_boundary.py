"""명령(단계) 경계가 공유 연결의 트랜잭션을 실제 PostgreSQL에서 어떻게 다루는지 고정한다(ADR 0059 결정 2).

왜 통합 시험인가: 암묵 트랜잭션이 열리는지, 되감으면 잠금이 풀리는지는 실제 연결의 동작이라 가짜로는
재현되지 않는다(EAT-264·273·274).
"""

from __future__ import annotations

import argparse
from typing import Any

import psycopg
import pytest

from eatbid.cli import main
from eatbid.composition import Application
from eatbid.config import ApplicationSettings
from eatbid.transaction_scope import UncommittedStepError

from .conftest import MigratedDatabase

_잠금키 = 28_900_002


class _닫히는클라이언트:
    """Application이 닫을 대상만 흉내 낸다. 이 시험은 HTTP를 쓰지 않는다."""

    def close(self) -> None:
        return None


class _원래원인(RuntimeError):
    """명령이 던진 진짜 원인이다. 경계의 가드가 이것을 다른 오류로 바꾸면 안 된다."""


class _시험애플리케이션(Application):
    """경계를 지나는 명령의 세 모양 — 남기고 성공, 남기고 실패, 깨끗이 성공 — 만 가진다."""

    def leave_open(self, args: argparse.Namespace) -> str:
        # 읽기 하나로도 psycopg는 암묵 트랜잭션을 연다. 2026-09-17 사고의 출발점이 이것이었다.
        with self._connection.cursor() as cursor:
            cursor.execute("select 1")
        return "성공이라고 보고한다"

    def fail_holding_lock(self, args: argparse.Namespace) -> None:
        # 트랜잭션이 끝나야 풀리는 잠금을 쥔 채 실패한다. 실패 기록을 별도 연결로 남기는 쪽이 이
        # 잠금을 기다리면 그대로 멈춘다(ADR 0059 Context의 fail_build 막힘).
        with self._connection.cursor() as cursor:
            cursor.execute("select pg_advisory_xact_lock(%s)", (_잠금키,))
        raise _원래원인("명령 본문의 실패")

    def clean(self, args: argparse.Namespace) -> str:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute("select 1")
        return "깨끗이 끝났다"

    def reap_marts(self, args: argparse.Namespace) -> Any:
        # CLI가 실제로 부르는 명령 이름 하나를 빌려 dispatch 경로 전체를 지나게 한다.
        return self.leave_open(args)


def _application(connection: Any) -> _시험애플리케이션:
    return _시험애플리케이션(connection=connection, http_client=_닫히는클라이언트())


def _다른_연결에서_잠금을_얻는다(migrated_db: MigratedDatabase) -> bool:
    with migrated_db.connect() as other, other.cursor() as cursor:
        cursor.execute("set lock_timeout = '2s'")
        cursor.execute("select pg_try_advisory_xact_lock(%s)", (_잠금키,))
        row = cursor.fetchone()
        return bool(row is not None and row[0])


def test_트랜잭션을_남기고_성공한_명령은_경계에서_실패로_바뀐다(
    migrated_db: MigratedDatabase,
) -> None:
    with migrated_db.connect() as connection:
        application = _application(connection)

        with pytest.raises(UncommittedStepError, match="leave_open"):
            application.run_command("leave_open", argparse.Namespace())

        # 경계가 되감아 두므로 같은 연결의 다음 명령(chunk의 다음 건)이 savepoint 위에서 돌지 않는다.
        assert connection.info.transaction_status is psycopg.pq.TransactionStatus.IDLE
        assert application.run_command("clean", argparse.Namespace()) == "깨끗이 끝났다"


def test_실패한_명령의_원래_예외가_그대로_올라오고_원_연결은_되감긴다(
    migrated_db: MigratedDatabase,
) -> None:
    with migrated_db.connect() as connection:
        application = _application(connection)

        with pytest.raises(_원래원인, match="명령 본문의 실패") as caught:
            application.run_command("fail_holding_lock", argparse.Namespace())

        assert connection.info.transaction_status is psycopg.pq.TransactionStatus.IDLE
        # 남아 있던 트랜잭션은 덮지 않고 덧붙인다. 운영자는 두 사실을 모두 봐야 한다.
        assert any("rolled back" in note for note in caught.value.__notes__)
        # 원 연결이 쥔 잠금이 풀렸으므로 별도 연결의 실패 기록은 기다리지 않는다.
        assert _다른_연결에서_잠금을_얻는다(migrated_db)


def test_예외가_올라가는_중에는_닫기_가드가_원래_예외를_덮지_않는다(
    migrated_db: MigratedDatabase,
) -> None:
    """경계를 거치지 않은 경로의 마지막 방벽이다. 가드의 판정은 버리지 않고 note로 남긴다."""
    connection = migrated_db.connect()

    with pytest.raises(_원래원인) as caught, _application(connection) as application:
        application.leave_open(argparse.Namespace())
        raise _원래원인("닫기 전에 난 실패")

    assert str(caught.value) == "닫기 전에 난 실패"
    assert any("uncommitted" in note for note in caught.value.__notes__)
    assert connection.closed


def test_CLI_dispatch도_트랜잭션을_남긴_명령을_실패_exit로_닫는다(
    migrated_db: MigratedDatabase,
    capsys: pytest.CaptureFixture[str],
) -> None:
    settings = ApplicationSettings.model_validate(
        {
            "DATABASE_URL": migrated_db.dsn,
            "R2_ENDPOINT_URL": "https://account.r2.cloudflarestorage.com",
            "R2_BUCKET": "eatbid-raw",
            "R2_ACCESS_KEY_ID": "access-secret",
            "R2_SECRET_ACCESS_KEY": "r2-secret",
            "SOURCE_CONNECT_TIMEOUT_SECONDS": 10,
            "SOURCE_READ_TIMEOUT_SECONDS": 30,
            "SOURCE_WRITE_TIMEOUT_SECONDS": 10,
            "SOURCE_POOL_TIMEOUT_SECONDS": 10,
            "SOURCE_PAGE_BUDGET": 100,
        }
    )
    connection = migrated_db.connect()

    exit_code = main(
        ["reap-marts", "--as-of", "2026-09-28T00:00:00Z"],
        application_factory=lambda _: _application(connection),
        settings=settings,
    )

    assert exit_code != 0
    assert "UncommittedStepError" in capsys.readouterr().err
    assert connection.closed
