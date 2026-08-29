from __future__ import annotations

import gzip
import re
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from typing import Protocol

_SLUG_PATTERN = re.compile(r"[a-z0-9-]+")
_OBJECT_KEY_PATTERN = re.compile(
    r"raw/(?P<source>[a-z0-9-]+)/(?P<endpoint>[a-z0-9-]+)/"
    r"(?P<content_sha256>[0-9a-f]{64})\.xml\.gz"
)


@dataclass(frozen=True, slots=True)
class StoredRawObject:
    content_sha256: str
    object_key: str
    byte_length: int
    stored_at: datetime


@dataclass(frozen=True, slots=True)
class RawObjectAddress:
    source: str
    endpoint: str
    content_sha256: str


class RawObjectStore(Protocol):
    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject: ...

    def read(self, object_key: str) -> bytes: ...


def raw_content_sha256(body: bytes) -> str:
    return sha256(body).hexdigest()


def build_raw_object_key(*, source: str, endpoint: str, body: bytes) -> str:
    _validate_slug(source)
    _validate_slug(endpoint)
    return f"raw/{source}/{endpoint}/{raw_content_sha256(body)}.xml.gz"


def parse_raw_object_key(object_key: str) -> RawObjectAddress:
    match = _OBJECT_KEY_PATTERN.fullmatch(object_key)
    if match is None:
        raise ValueError("invalid raw object key")
    return RawObjectAddress(**match.groupdict())


def deterministic_gzip(body: bytes) -> bytes:
    output = BytesIO()
    with gzip.GzipFile(fileobj=output, mode="wb", filename="", mtime=0) as archive:
        archive.write(body)
    return output.getvalue()


def _validate_slug(value: str) -> None:
    if _SLUG_PATTERN.fullmatch(value) is None:
        raise ValueError("source and endpoint must be lowercase kebab-case slugs")
