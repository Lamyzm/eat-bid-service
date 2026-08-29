from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from botocore.exceptions import ClientError
from eatbid.object_store import (
    StoredRawObject,
    build_raw_object_key,
    parse_raw_object_key,
)


class MemoryRawObjectStore:
    def __init__(self) -> None:
        self._objects: dict[str, tuple[bytes, StoredRawObject]] = {}

    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        object_key = build_raw_object_key(source=source, endpoint=endpoint, body=body)
        existing = self._objects.get(object_key)
        if existing is not None:
            return existing[1]
        address = parse_raw_object_key(object_key)
        stored = StoredRawObject(
            content_sha256=address.content_sha256,
            object_key=object_key,
            byte_length=len(body),
            stored_at=datetime.now(UTC),
        )
        self._objects[object_key] = (body, stored)
        return stored

    def read(self, object_key: str) -> bytes:
        parse_raw_object_key(object_key)
        return self._objects[object_key][0]


@dataclass
class FakeS3Object:
    body: bytes
    metadata: dict[str, str]
    content_encoding: str
    content_type: str
    last_modified: datetime
    content_length: int


class FakeBody:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body


class StatefulFakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[str, FakeS3Object] = {}
        self.head_requests: list[dict[str, object]] = []
        self.put_requests: list[dict[str, object]] = []
        self.get_requests: list[dict[str, object]] = []
        self.head_error: Exception | None = None

    def head_object(self, **kwargs: object) -> dict[str, object]:
        self.head_requests.append(kwargs)
        if self.head_error is not None:
            raise self.head_error
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
        key = str(kwargs["Key"])
        if key not in self.objects:
            raise client_error("NoSuchKey", "GetObject", status=404)
        stored = self.objects[key]
        return {
            "Body": FakeBody(stored.body),
            "ContentLength": stored.content_length,
            "ContentEncoding": stored.content_encoding,
            "ContentType": stored.content_type,
            "Metadata": stored.metadata.copy(),
            "LastModified": stored.last_modified,
        }


def client_error(code: str, operation: str, *, status: int) -> ClientError:
    response: dict[str, Any] = {
        "Error": {"Code": code, "Message": "fake provider response"},
        "ResponseMetadata": {"HTTPStatusCode": status},
    }
    return ClientError(response, operation)
