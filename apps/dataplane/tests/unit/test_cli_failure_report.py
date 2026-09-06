from __future__ import annotations

import json
from typing import Any

import psycopg
import pytest

from eatbid.cli import main
from eatbid.composition import build_application
from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.failure_report import redact_secrets
from eatbid.pipeline.capture import SourceThrottledError
from eatbid.pipeline.normalize import DataQuarantinedError

from .test_cli import RUN_ID, SHA, _기록애플리케이션, _명령, _설정

FIELDS = frozenset(
    {"build_sha", "category", "error", "message", "parser_version", "run_id"}
)

_비밀_환경변수 = ("DATABASE_URL", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


@pytest.fixture(autouse=True)
def _비밀_환경변수를_비운다(monkeypatch: pytest.MonkeyPatch) -> None:
    """왜: 이 모듈만 마스킹된 문자열을 문자 그대로 비교한다. `_secret_values`는 설정과 함께
    실행 환경의 비밀값도 읽으므로, runner에 남은 DSN·R2 키가 결과를 바꾸지 못하게 먼저 비운다."""
    for name in _비밀_환경변수:
        monkeypatch.delenv(name, raising=False)


def _한줄_JSON(captured: str) -> dict[str, Any]:
    lines = captured.splitlines()
    assert len(lines) == 1
    payload = json.loads(lines[0])
    assert set(payload) == FIELDS
    return payload


def _실패(
    error: Exception,
    capsys: pytest.CaptureFixture[str],
    *,
    command: str = "discover",
) -> tuple[int, dict[str, Any]]:
    application = _기록애플리케이션(error=error)
    exit_code = main(
        _명령(command), application_factory=lambda _: application, settings=_설정()
    )
    return exit_code, _한줄_JSON(capsys.readouterr().err)


def test_권한_오류는_InsufficientPrivilege를_한_줄_JSON으로_남긴다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    exit_code, payload = _실패(
        psycopg.errors.InsufficientPrivilege("permission denied for table auction"),
        capsys,
    )

    assert exit_code == 64
    assert payload["category"] == "CONFIGURATION"
    assert payload["error"] == "InsufficientPrivilege"
    assert "permission denied for table auction" in payload["message"]
    assert (payload["run_id"], payload["build_sha"], payload["parser_version"]) == (
        RUN_ID,
        SHA,
        "eat-v1",
    )


def test_DB_연결_실패는_OperationalError를_원인으로_구분한다(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def 연결실패(_: str) -> object:
        raise psycopg.OperationalError(
            'connection to server at "10.0.0.5", port 5432 failed: timeout expired'
        )

    monkeypatch.setattr("eatbid.composition.psycopg.connect", 연결실패)

    exit_code = main(
        _명령("normalize"), application_factory=build_application, settings=_설정()
    )
    payload = _한줄_JSON(capsys.readouterr().err)

    assert exit_code == 64
    assert payload["category"] == "CONFIGURATION"
    assert payload["error"] == "OperationalError"
    assert "timeout expired" in payload["message"]
    assert "db-password" not in payload["message"]


def test_설정_검증_실패는_ValidationError로_구분된다(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    for name in (
        "DATABASE_URL",
        "R2_ENDPOINT_URL",
        "R2_BUCKET",
        "R2_ACCESS_KEY_ID",
        "R2_SECRET_ACCESS_KEY",
    ):
        monkeypatch.delenv(name, raising=False)

    exit_code = main(
        _명령("discover"), application_factory=lambda _: _기록애플리케이션()
    )
    payload = _한줄_JSON(capsys.readouterr().err)

    assert exit_code == 64
    assert payload["error"] == "ValidationError"
    assert "DATABASE_URL" in payload["message"]


def test_실패_메시지에서_DSN_비밀번호와_R2_키를_지운다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    유출 = (
        "boto3 rejected access-secret/r2-secret while opening "
        "postgresql://user:db-password@localhost:5432/eatbid"
    )

    _, payload = _실패(RuntimeError(유출), capsys)

    message = str(payload["message"])
    assert all(
        secret not in message
        for secret in ("db-password", "access-secret", "r2-secret")
    )
    assert "postgresql://user:***@localhost:5432/eatbid" in message


def test_설정에_없는_DSN도_비밀번호_자리를_가린다(
    capsys: pytest.CaptureFixture[str],
) -> None:
    _, payload = _실패(
        RuntimeError("postgres://other:unlisted-password@replica:5432/eatbid"), capsys
    )

    assert "unlisted-password" not in str(payload["message"])
    assert "postgres://other:***@replica:5432/eatbid" in str(payload["message"])


def test_비밀번호가_database_이름과_같아도_누출없이_가린다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://eatbid:eatbid@localhost:5432/eatbid")

    가려진 = redact_secrets(
        "psycopg failed on postgres://eatbid:eatbid@localhost:5432/eatbid"
    )

    assert "eatbid" not in 가려진
    assert "***" in 가려진


def test_settings가_없으면_환경변수의_비밀값으로_지운다(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:env-db-password@db:5432/eat")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "env-access-key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "env-secret-key")

    assert (
        redact_secrets("env-access-key env-secret-key env-db-password") == "*** *** ***"
    )


@pytest.mark.parametrize(
    ("error", "exit_code", "category", "error_name"),
    [
        (RuntimeError("설정이 없다"), 64, "CONFIGURATION", "RuntimeError"),
        (DataQuarantinedError(7, "격리"), 65, "DATA_QUARANTINED", "DataQuarantinedError"),
        (
            SourceUnavailableError("일시 장애", attempts=3),
            69,
            "TRANSIENT_NETWORK",
            "SourceUnavailableError",
        ),
        (SourceThrottledError(429), 75, "SOURCE_THROTTLED", "SourceThrottledError"),
        (SourceContractError("계약 위반"), 76, "SOURCE_CONTRACT", "SourceContractError"),
    ],
)
def test_카테고리별_exit_code를_유지하고_예외_클래스명을_함께_남긴다(
    error: Exception,
    exit_code: int,
    category: str,
    error_name: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    실제_code, payload = _실패(error, capsys)

    assert 실제_code == exit_code
    assert (payload["category"], payload["error"]) == (category, error_name)
    assert payload["message"] == str(error)
