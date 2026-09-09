from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from botocore.exceptions import ClientError

from eatbid.source.client import SourceResponse
from eatbid.storage.object_store import (
    MEDIA_XML,
    StoredRawObject,
    build_raw_object_key,
    parse_raw_object_key,
)


class MemoryRawObjectStore:
    def __init__(self, now: Callable[[], datetime] | None = None) -> None:
        self._objects: dict[str, tuple[bytes, StoredRawObject]] = {}
        self._now = now if now is not None else lambda: datetime.now(UTC)

    def put(
        self, *, source: str, endpoint: str, body: bytes, media: str = MEDIA_XML
    ) -> StoredRawObject:
        object_key = build_raw_object_key(
            source=source, endpoint=endpoint, body=body, media=media
        )
        existing = self._objects.get(object_key)
        if existing is not None:
            return existing[1]
        address = parse_raw_object_key(object_key)
        stored = StoredRawObject(
            content_sha256=address.content_sha256,
            object_key=object_key,
            byte_length=len(body),
            stored_at=self._now(),
        )
        self._objects[object_key] = (body, stored)
        return stored

    def read(self, object_key: str) -> bytes:
        parse_raw_object_key(object_key)
        return self._objects[object_key][0]

    @property
    def object_count(self) -> int:
        return len(self._objects)


class RecordingStore:
    def __init__(self, events: list[str]) -> None:
        self._delegate = MemoryRawObjectStore()
        self._events = events

    def put(
        self, *, source: str, endpoint: str, body: bytes, media: str = MEDIA_XML
    ) -> StoredRawObject:
        stored = self._delegate.put(
            source=source, endpoint=endpoint, body=body, media=media
        )
        self._events.append("object_stored")
        return stored

    def read(self, object_key: str) -> bytes:
        return self._delegate.read(object_key)


class FailingRawObjectStore:
    def put(
        self, *, source: str, endpoint: str, body: bytes, media: str = MEDIA_XML
    ) -> StoredRawObject:
        raise RuntimeError("archive unavailable")

    def read(self, object_key: str) -> bytes:
        raise KeyError(object_key)


class StaticSourceClient:
    def __init__(self, response: SourceResponse) -> None:
        self.response = response
        self.requests: list[object] = []

    def fetch(self, request: object) -> SourceResponse:
        self.requests.append(request)
        return self.response


@dataclass
class FakeS3Object:
    body: bytes
    metadata: dict[str, str]
    content_encoding: str
    content_type: str
    last_modified: datetime
    content_length: int


class FakeBody:
    def __init__(self, body: bytes, *, read_error: Exception | None = None) -> None:
        self._body = body
        self._read_error = read_error

    def read(self) -> bytes:
        if self._read_error is not None:
            raise self._read_error
        return self._body


class StatefulFakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, FakeS3Object] = {}
        self.head_requests: list[dict[str, object]] = []
        self.head_errors: list[Exception] = []
        self.put_requests: list[dict[str, object]] = []
        self.get_requests: list[dict[str, object]] = []
        self.head_error: Exception | None = None
        self.put_error: Exception | None = None
        self.get_error: Exception | None = None
        self.body_read_error: Exception | None = None
        self.concurrent_put_winner: FakeS3Object | None = None
        self.head_error_after_put: Exception | None = None

    def head_object(self, **kwargs: object) -> dict[str, object]:
        self.head_requests.append(kwargs)
        if self.head_errors:
            raise self.head_errors.pop(0)
        if self.head_error is not None:
            raise self.head_error
        if self.put_requests and self.head_error_after_put is not None:
            raise self.head_error_after_put
        key = str(kwargs["Key"])
        if key not in self.objects:
            raise client_error("404", "HeadObject", status=404)
        stored = self.objects[key]
        return {
            "ContentLength": stored.content_length,
            "ContentEncoding": stored.content_encoding,
            "ContentType": stored.content_type,
            "Metadata": stored.metadata.copy(),
            "LastModified": stored.last_modified,
        }

    def put_object(self, **kwargs: object) -> dict[str, object]:
        self.put_requests.append(kwargs)
        key = str(kwargs["Key"])
        if self.concurrent_put_winner is not None:
            self.objects[key] = self.concurrent_put_winner
            self.concurrent_put_winner = None
            raise client_error("PreconditionFailed", "PutObject", status=412)
        if self.put_error is not None:
            raise self.put_error
        body = bytes(kwargs["Body"])
        metadata = dict(kwargs["Metadata"])  # type: ignore[arg-type]
        self.objects[key] = FakeS3Object(
            body=body,
            metadata=metadata,
            content_encoding=str(kwargs["ContentEncoding"]),
            content_type=str(kwargs["ContentType"]),
            last_modified=datetime(2026, 8, 29, 1, 2, 3, tzinfo=UTC),
            content_length=len(body),
        )
        return {"ETag": '"fake"'}

    def get_object(self, **kwargs: object) -> dict[str, object]:
        self.get_requests.append(kwargs)
        if self.get_error is not None:
            raise self.get_error
        key = str(kwargs["Key"])
        if key not in self.objects:
            raise client_error("NoSuchKey", "GetObject", status=404)
        stored = self.objects[key]
        return {
            "Body": FakeBody(stored.body, read_error=self.body_read_error),
            "ContentLength": stored.content_length,
            "ContentEncoding": stored.content_encoding,
            "ContentType": stored.content_type,
            "Metadata": stored.metadata.copy(),
            "LastModified": stored.last_modified,
        }


def client_error(
    code: str | None,
    operation: str,
    *,
    status: int,
    message: str = "fake provider response",
) -> ClientError:
    error: dict[str, str] = {"Message": message}
    if code is not None:
        error["Code"] = code
    response: dict[str, Any] = {
        "Error": error,
        "ResponseMetadata": {"HTTPStatusCode": status},
    }
    return ClientError(response, operation)
