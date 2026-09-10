"""모듈 책임: dataplane production 설정을 bounded 값으로 검증하고 비밀 표현을 차단한다."""

from __future__ import annotations

from urllib.parse import urlsplit

from pydantic import AnyHttpUrl, Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class ApplicationSettings(BaseSettings):
    model_config = SettingsConfigDict(
        frozen=True,
        extra="ignore",
        hide_input_in_errors=True,
        populate_by_name=True,
    )

    database_url: SecretStr = Field(validation_alias="DATABASE_URL", repr=False)
    r2_endpoint_url: AnyHttpUrl = Field(validation_alias="R2_ENDPOINT_URL", repr=False)
    r2_bucket: str = Field(
        validation_alias="R2_BUCKET",
        min_length=3,
        max_length=63,
        pattern=r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$",
    )
    r2_access_key_id: SecretStr = Field(
        validation_alias="R2_ACCESS_KEY_ID", min_length=1, repr=False
    )
    r2_secret_access_key: SecretStr = Field(
        validation_alias="R2_SECRET_ACCESS_KEY", min_length=1, repr=False
    )
    # 왜 둘 다 선택인가: 무효화는 발행이 끝난 뒤의 알림이고, 설정이 없으면 조용히 건너뛴다.
    # 필수로 만들면 web을 아직 세우지 않은 환경에서 수집 자체가 기동하지 못한다(ADR 0036-3).
    # 클러스터 내부 Service URL이라 터널·Ingress를 지나지 않는다.
    web_internal_url: AnyHttpUrl | None = Field(
        None, validation_alias="EATBID_WEB_INTERNAL_URL"
    )
    cache_revalidate_token: SecretStr | None = Field(
        None, validation_alias="EATBID_CACHE_REVALIDATE_TOKEN", repr=False
    )
    source_connect_timeout_seconds: int = Field(
        10, validation_alias="SOURCE_CONNECT_TIMEOUT_SECONDS", ge=1, le=300
    )
    source_read_timeout_seconds: int = Field(
        30, validation_alias="SOURCE_READ_TIMEOUT_SECONDS", ge=1, le=300
    )
    source_write_timeout_seconds: int = Field(
        10, validation_alias="SOURCE_WRITE_TIMEOUT_SECONDS", ge=1, le=300
    )
    source_pool_timeout_seconds: int = Field(
        10, validation_alias="SOURCE_POOL_TIMEOUT_SECONDS", ge=1, le=300
    )
    source_page_budget: int = Field(
        100, validation_alias="SOURCE_PAGE_BUDGET", ge=1, le=10_000
    )
    # 왜: 재시도 상한은 manifest가 아니라 설정이 소유한다. 한 pod가 소스를 붙잡는 시간이 늘어나면
    # source semaphore 뒤의 다른 실행이 밀리므로 횟수와 총 대기 시간을 함께 bounded로 둔다.
    # 기본값의 근거: 총 30초 예산은 2026-09-07~09 backfill에서 몇 초짜리 소스 흔들림에도 한 달 창을
    # 통째로 죽였다(EAT-122). 1분 남짓의 장애를 흡수하되 semaphore 뒤 실행의 최대 대기가 chunk 하나
    # 길이에 2분을 더한 정도에 머무는 선이다.
    source_retry_max_attempts: int = Field(
        5, validation_alias="SOURCE_RETRY_MAX_ATTEMPTS", ge=1, le=10
    )
    source_retry_initial_backoff_seconds: int = Field(
        5, validation_alias="SOURCE_RETRY_INITIAL_BACKOFF_SECONDS", ge=0, le=60
    )
    source_retry_backoff_multiplier: int = Field(
        2, validation_alias="SOURCE_RETRY_BACKOFF_MULTIPLIER", ge=1, le=10
    )
    source_retry_max_total_backoff_seconds: int = Field(
        120, validation_alias="SOURCE_RETRY_MAX_TOTAL_BACKOFF_SECONDS", ge=0, le=600
    )
    # 감시(check-expectations)만 쓰는 값이다. 왜 선택인가: 수집 pod는 이 값 없이 떠야 한다. 필수로
    # 만들면 알림 설정이 빠진 환경에서 수집 자체가 기동하지 못한다(cache 무효화와 같은 이유, ADR 0036-3).
    # 알림 대상이 없으면 감시 명령이 그 사실을 밝히고 실패한다. 조용히 건너뛰면 알림이 안 가는 상태가
    # 정상으로 보인다.
    environment_name: str = Field(
        "unknown", validation_alias="EATBID_ENVIRONMENT", min_length=1, max_length=32
    )
    telegram_bot_token: SecretStr | None = Field(
        None, validation_alias="TELEGRAM_BOT_TOKEN", repr=False
    )
    telegram_chat_id: str | None = Field(None, validation_alias="TELEGRAM_CHAT_ID")

    @field_validator("database_url")
    @classmethod
    def validate_database_url(cls, value: SecretStr) -> SecretStr:
        try:
            parsed = urlsplit(value.get_secret_value())
        except ValueError:
            raise ValueError("DATABASE_URL must be a PostgreSQL DSN") from None
        if (
            parsed.scheme not in {"postgresql", "postgres"}
            or parsed.hostname is None
            or not parsed.path.strip("/")
        ):
            raise ValueError("DATABASE_URL must be a PostgreSQL DSN")
        return value
