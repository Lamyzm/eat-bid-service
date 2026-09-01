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

