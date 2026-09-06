"""모듈 책임: source 호출 경계가 주고받는 응답 값 객체와 client port를 정의한다."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from eatbid.ingest.models import CaptureRequest


@dataclass(frozen=True, slots=True)
class SourceResponse:
    # 왜: 이 응답을 몇 번째 HTTP 시도에서 받았는지는 해석이 아니라 관측이다. client가 그 숫자를
    # 버리면 소스가 얼마나 불안정했는지를 성공한 실행에서는 어디에서도 되짚을 수 없다. 재시도가
    # 없었던 client는 1을 그대로 쓴다.
    status_code: int
    body: bytes
    fetched_at: datetime
    attempts: int = 1

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
        if (
            isinstance(self.attempts, bool)
            or not isinstance(self.attempts, int)
            or self.attempts < 1
        ):
            raise ValueError("attempts must be a positive integer")


class SourceClient(Protocol):
    def fetch(self, request: CaptureRequest) -> SourceResponse: ...
