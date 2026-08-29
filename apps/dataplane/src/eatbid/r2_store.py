from __future__ import annotations

import gzip
import zlib
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Protocol, cast

import boto3
from botocore.exceptions import ClientError
from pydantic import AnyHttpUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

from eatbid.object_store import (
    RawObjectAddress,
    StoredRawObject,
    build_raw_object_key,
    deterministic_gzip,
    parse_raw_object_key,
    raw_content_sha256,
)

_CONTENT_ENCODING = "gzip"
_CONTENT_TYPE = "application/xml"
_HASH_METADATA_KEY = "source-sha256"
_LENGTH_METADATA_KEY = "source-byte-length"
_NOT_FOUND_CODES = frozenset({"404", "NoSuchKey", "NotFound"})


class ObjectCollisionError(RuntimeError):
    """An existing content address does not match the bytes being archived."""


class ObjectCorruptionError(RuntimeError):
    """A stored raw object no longer satisfies its content-address contract."""


class R2Settings(BaseSettings):
    model_config = SettingsConfigDict(
        frozen=True,
        extra="ignore",
        hide_input_in_errors=True,
        populate_by_name=True,
    )

    endpoint_url: AnyHttpUrl = Field(
        validation_alias="R2_ENDPOINT_URL", repr=False
    )
    bucket: str = Field(validation_alias="R2_BUCKET", min_length=1)
    access_key_id: SecretStr = Field(
        validation_alias="R2_ACCESS_KEY_ID", min_length=1, repr=False
    )
    secret_access_key: SecretStr = Field(
        validation_alias="R2_SECRET_ACCESS_KEY", min_length=1, repr=False
    )


class _ReadableBody(Protocol):
    def read(self) -> bytes: ...


class S3Client(Protocol):
    def head_object(self, **kwargs: object) -> dict[str, object]: ...

    def put_object(self, **kwargs: object) -> dict[str, object]: ...

    def get_object(self, **kwargs: object) -> dict[str, object]: ...


class R2RawObjectStore:
    def __init__(self, settings: R2Settings, *, client: S3Client | None = None) -> None:
        self._settings = settings
        if client is None:
            client = cast(
                S3Client,
                boto3.client(
                    "s3",
                    endpoint_url=str(settings.endpoint_url),
                    aws_access_key_id=settings.access_key_id.get_secret_value(),
                    aws_secret_access_key=settings.secret_access_key.get_secret_value(),
                ),
            )
        self._client = client

    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        object_key = build_raw_object_key(source=source, endpoint=endpoint, body=body)
        address = parse_raw_object_key(object_key)
        compressed = deterministic_gzip(body)

        try:
            existing = self._client.head_object(
                Bucket=self._settings.bucket, Key=object_key
            )
        except ClientError as error:
            if not _is_not_found(error):
                raise
        else:
            _validate_existing_object(
                existing,
                address=address,
                raw_length=len(body),
                compressed_length=len(compressed),
            )
            return StoredRawObject(
                content_sha256=address.content_sha256,
                object_key=object_key,
                byte_length=len(body),
                stored_at=_existing_last_modified(existing),
            )

        self._client.put_object(
            Bucket=self._settings.bucket,
            Key=object_key,
            Body=compressed,
            ContentEncoding=_CONTENT_ENCODING,
            ContentType=_CONTENT_TYPE,
            Metadata={
                _HASH_METADATA_KEY: address.content_sha256,
                _LENGTH_METADATA_KEY: str(len(body)),
            },
        )
        return StoredRawObject(
            content_sha256=address.content_sha256,
            object_key=object_key,
            byte_length=len(body),
            stored_at=datetime.now(UTC),
        )

    def read(self, object_key: str) -> bytes:
        address = parse_raw_object_key(object_key)
        response = self._client.get_object(
            Bucket=self._settings.bucket, Key=object_key
        )
        compressed = _read_response_body(response)
        raw_length = _validate_read_envelope(
            response, address=address, compressed_length=len(compressed)
        )
        try:
            raw = gzip.decompress(compressed)
        except (OSError, EOFError, zlib.error) as error:
            raise ObjectCorruptionError("stored raw object is corrupt") from error
        if (
            len(raw) != raw_length
            or raw_content_sha256(raw) != address.content_sha256
            or compressed != deterministic_gzip(raw)
        ):
            raise ObjectCorruptionError("stored raw object is corrupt")
        return raw


def _is_not_found(error: ClientError) -> bool:
    response = error.response
    error_details = response.get("Error", {})
    code = error_details.get("Code") if isinstance(error_details, Mapping) else None
    response_metadata = response.get("ResponseMetadata", {})
    status = (
        response_metadata.get("HTTPStatusCode")
        if isinstance(response_metadata, Mapping)
        else None
    )
    return code in _NOT_FOUND_CODES or status == 404


def _validate_existing_object(
    response: Mapping[str, object],
    *,
    address: RawObjectAddress,
    raw_length: int,
    compressed_length: int,
) -> None:
    metadata = _metadata(response, ObjectCollisionError)
    if (
        response.get("ContentLength") != compressed_length
        or response.get("ContentEncoding") != _CONTENT_ENCODING
        or response.get("ContentType") != _CONTENT_TYPE
        or metadata.get(_HASH_METADATA_KEY) != address.content_sha256
        or metadata.get(_LENGTH_METADATA_KEY) != str(raw_length)
    ):
        raise ObjectCollisionError("raw object content-address collision")


def _existing_last_modified(response: Mapping[str, object]) -> datetime:
    last_modified = response.get("LastModified")
    if not isinstance(last_modified, datetime) or last_modified.utcoffset() is None:
        raise ObjectCollisionError("raw object content-address collision")
    return last_modified.astimezone(UTC)


def _read_response_body(response: Mapping[str, object]) -> bytes:
    body = response.get("Body")
    if body is None or not hasattr(body, "read"):
        raise ObjectCorruptionError("stored raw object is corrupt")
    compressed = cast(_ReadableBody, body).read()
    if not isinstance(compressed, bytes):
        raise ObjectCorruptionError("stored raw object is corrupt")
    return compressed


def _validate_read_envelope(
    response: Mapping[str, object],
    *,
    address: RawObjectAddress,
    compressed_length: int,
) -> int:
    metadata = _metadata(response, ObjectCorruptionError)
    raw_length_text = metadata.get(_LENGTH_METADATA_KEY)
    try:
        raw_length = int(raw_length_text) if raw_length_text is not None else -1
    except ValueError as error:
        raise ObjectCorruptionError("stored raw object is corrupt") from error
    if (
        raw_length < 0
        or str(raw_length) != raw_length_text
        or response.get("ContentLength") != compressed_length
        or response.get("ContentEncoding") != _CONTENT_ENCODING
        or response.get("ContentType") != _CONTENT_TYPE
        or metadata.get(_HASH_METADATA_KEY) != address.content_sha256
    ):
        raise ObjectCorruptionError("stored raw object is corrupt")
    return raw_length


def _metadata(
    response: Mapping[str, object], error_type: type[RuntimeError]
) -> Mapping[str, str]:
    metadata = response.get("Metadata")
    if not isinstance(metadata, Mapping) or not all(
        isinstance(key, str) and isinstance(value, str)
        for key, value in metadata.items()
    ):
        raise error_type("stored raw object metadata is invalid")
    return cast(Mapping[str, str], metadata)
