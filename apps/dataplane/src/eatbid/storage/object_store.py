"""모듈 책임: raw 객체의 내용 주소 키 형식과 결정적 압축 규칙, 그 키가 말하는 저장 미디어를 소유한다.

키가 미디어를 포함하는 이유는 나중에 그 객체만 보고 여는 소비자가 파서를 고를 수 있어야 하기
때문이다. eaT XML과 정부 탭 구분 텍스트가 같은 확장자를 쓰면 키가 내용에 대해 거짓말을 한다.
"""

from __future__ import annotations

import gzip
import re
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from typing import Protocol

_SLUG_PATTERN = re.compile(r"[a-z0-9-]+")
# 저장 미디어는 객체 키의 일부다. 정부 공개 파일은 탭 구분 텍스트라 `.xml.gz`로 저장하면 키가
# 내용에 대해 거짓말을 하고, 나중에 그 키만 보고 여는 소비자가 파서를 잘못 고른다.
MEDIA_XML = "xml"
MEDIA_TEXT = "txt"
_OBJECT_KEY_PATTERN = re.compile(
    r"raw/(?P<source>[a-z0-9-]+)/(?P<endpoint>[a-z0-9-]+)/"
    rf"(?P<content_sha256>[0-9a-f]{{64}})\.(?P<media>{MEDIA_XML}|{MEDIA_TEXT})\.gz"
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
    media: str = MEDIA_XML


class RawObjectStore(Protocol):
    def put(
        self, *, source: str, endpoint: str, body: bytes, media: str = MEDIA_XML
    ) -> StoredRawObject: ...

    def read(self, object_key: str) -> bytes: ...


def raw_content_sha256(body: bytes) -> str:
    return sha256(body).hexdigest()


def build_raw_object_key(
    *, source: str, endpoint: str, body: bytes, media: str = MEDIA_XML
) -> str:
    _validate_slug(source)
    _validate_slug(endpoint)
    if media not in {MEDIA_XML, MEDIA_TEXT}:
        raise ValueError("raw object media must be a reviewed archive media")
    return f"raw/{source}/{endpoint}/{raw_content_sha256(body)}.{media}.gz"


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
