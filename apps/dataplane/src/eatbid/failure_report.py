"""모듈 책임: CLI 실패를 원인 구분이 가능한 한 줄 JSON으로 만들고 그 안의 비밀값을 지운다."""

from __future__ import annotations

import argparse
import json
import os
import re
from urllib.parse import urlsplit

from eatbid.config import ApplicationSettings

REDACTED = "***"

# 왜: psycopg·boto3·httpx 오류 문자열은 접속에 쓴 DSN을 그대로 되풀이한다. 설정 로딩 자체가
# 실패해 비밀 목록을 못 얻는 경로에서도 비밀번호 자리를 지우려면 형태로도 한 번 더 막아야 한다.
_DSN_PASSWORD = re.compile(
    r"(?P<prefix>[A-Za-z][A-Za-z0-9+.\-]*://[^\s:/@]*:)[^\s/@]+(?P<suffix>@)"
)

_SECRET_ENV_NAMES = ("R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")
_DSN_ENV_NAME = "DATABASE_URL"

_IDENTITY_FIELDS = ("run_id", "build_sha", "parser_version")


class ApplicationConfigurationError(RuntimeError):
    """왜: 조립 단계 예외 객체는 traceback과 함께 DSN·credential을 실어 나른다. 원인 구분에
    필요한 클래스명과 문자열만 복사해 두고 예외 객체 자체는 CLI 경계 밖으로 내보내지 않는다."""

    def __init__(self, cause: BaseException) -> None:
        super().__init__("application configuration failed")
        self.cause_name = type(cause).__name__
        self.cause_message = str(cause)


def redact_secrets(text: str, settings: ApplicationSettings | None = None) -> str:
    """설정과 환경변수에서 얻은 비밀값을 지운 뒤 남은 DSN 비밀번호 자리를 가린다."""
    redacted = text
    for secret in _secret_values(settings):
        redacted = redacted.replace(secret, REDACTED)
    return _DSN_PASSWORD.sub(rf"\g<prefix>{REDACTED}\g<suffix>", redacted)


def render_failure(
    error: BaseException,
    *,
    category: str,
    args: argparse.Namespace | None = None,
    settings: ApplicationSettings | None = None,
) -> str:
    """왜: 실패 진단은 workflow pod 로그에 한 줄로만 남는다. stdout의 machine result와 같은
    직렬화 규칙을 써서 로그 수집기가 줄 단위로 그대로 파싱할 수 있게 한다."""
    payload = {
        "category": category,
        "error": _error_name(error),
        "message": redact_secrets(_message(error), settings),
        **{name: _identity(args, name) for name in _IDENTITY_FIELDS},
    }
    return json.dumps(payload, sort_keys=True, separators=(",", ":"))


def _error_name(error: BaseException) -> str:
    if isinstance(error, ApplicationConfigurationError):
        return error.cause_name
    return type(error).__name__


def _message(error: BaseException) -> str:
    if isinstance(error, ApplicationConfigurationError):
        return f"{error}: {error.cause_message}"
    return str(error)


def _identity(args: argparse.Namespace | None, field: str) -> str | None:
    value = getattr(args, field, None)
    return None if value is None else str(value)


def _secret_values(settings: ApplicationSettings | None) -> tuple[str, ...]:
    """왜: 설정이 만들어지기 전에도 실패할 수 있어 환경변수를 같은 자리에서 함께 읽는다.
    긴 값부터 지워야 다른 비밀의 접두사인 값이 먼저 잘려 원본 일부가 남지 않는다."""
    values = [os.environ.get(name, "") for name in _SECRET_ENV_NAMES]
    dsns = [os.environ.get(_DSN_ENV_NAME, "")]
    if settings is not None:
        values.append(settings.r2_access_key_id.get_secret_value())
        values.append(settings.r2_secret_access_key.get_secret_value())
        dsns.append(settings.database_url.get_secret_value())
    values.extend(password for dsn in dsns if (password := _dsn_password(dsn)))
    return tuple(sorted({value for value in values if value}, key=len, reverse=True))


def _dsn_password(dsn: str) -> str | None:
    try:
        return urlsplit(dsn).password
    except ValueError:
        return None
