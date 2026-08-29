from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from eatbid.ingest.models import CaptureRequest


@dataclass(frozen=True, slots=True)
class SourceResponse:
    status_code: int
    body: bytes
    fetched_at: datetime

    def __post_init__(self) -> None:
        if (
            isinstance(self.status_code, bool)
            or not isinstance(self.status_code, int)
            or not 100 <= self.status_code <= 599
        ):
            raise ValueError("status_code must be an HTTP status from 100 through 599")
        if not isinstance(self.body, bytes):
            raise TypeError("body must be bytes")
        if not isinstance(self.fetched_at, datetime):
            raise TypeError("fetched_at must be a datetime")
        if self.fetched_at.utcoffset() is None:
            raise ValueError("fetched_at must be timezone-aware")


class SourceClient(Protocol):
    def fetch(self, request: CaptureRequest) -> SourceResponse: ...
