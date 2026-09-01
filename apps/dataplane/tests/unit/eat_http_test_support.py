from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Self
from uuid import UUID

import httpx

from eatbid.ingest.models import CaptureRequest

FETCHED_AT = datetime(2026, 9, 1, 3, 4, 5, tzinfo=UTC)


def capture_request(
    endpoint: str = "bid-detail", params: dict[str, str] | None = None
) -> CaptureRequest:
    return CaptureRequest(
        request_unit_id=1,
        run_id=UUID("00000000-0000-0000-0000-000000000001"),
        source="eat",
        endpoint=endpoint,
        params=params or {"ELCTRN_BID_ID": "5291468"},
    )


def list_request(**overrides: str) -> CaptureRequest:
    params = {
        "P_BID_BGNG_DT": "20260801",
        "P_BID_END_DT": "20260831",
        "P_PRGRS_STAT_CD": "007",
        "P_CTPV_CD": "1",
        "START_PAGE": "1",
        "PAGE_SIZE": "1000",
    }
    params.update(overrides)
    return capture_request(endpoint="bid-list", params=params)


class TrackingStream(httpx.SyncByteStream):
    def __init__(self, chunks: tuple[bytes, ...]) -> None:
        self._chunks = chunks
        self.yielded = 0
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        for chunk in self._chunks:
            self.yielded += 1
            yield chunk

    def close(self) -> None:
        self.closed = True


class FailingStream(httpx.SyncByteStream):
    def __init__(self, upstream_error: httpx.HTTPError) -> None:
        self._upstream_error = upstream_error
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        yield b"partial-source-bytes"
        raise self._upstream_error

    def close(self) -> None:
        self.closed = True


class RecordingTransport(httpx.BaseTransport):
    def __init__(self, handler: Callable[[httpx.Request], httpx.Response]) -> None:
        self.handler = handler
        self.requests: list[httpx.Request] = []
        self.closed = False
        self.close_calls = 0

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.handler(request)

    def close(self) -> None:
        self.closed = True
        self.close_calls += 1


class ExplodingTimezone(tzinfo):
    def __init__(self, *, fail_after_calls: int) -> None:
        self._fail_after_calls = fail_after_calls
        self._calls = 0

    def utcoffset(self, value: datetime | None) -> timedelta:
        self._calls += 1
        if self._calls > self._fail_after_calls:
            raise RuntimeError("tzinfo-provider-secret")
        return timedelta(0)

    def dst(self, value: datetime | None) -> timedelta:
        return timedelta(0)

    def tzname(self, value: datetime | None) -> str:
        return "TEST"


def raising_clock() -> datetime:
    raise RuntimeError("clock-provider-secret")


class RepeatedOffsetAdversarialDatetime(datetime):
    def __new__(cls) -> Self:
        instance = super().__new__(cls, 2026, 9, 1, 3, 4, 5, tzinfo=UTC)
        instance.offset_calls = 0
        return instance

    def utcoffset(self) -> timedelta:
        self.offset_calls += 1
        if self.offset_calls > 2:
            raise RuntimeError("tzinfo-provider-secret")
        return timedelta(0)

    def astimezone(self, target_timezone: tzinfo | None = None) -> datetime:
        return self


class FailingCloseTransport(RecordingTransport):
    def close(self) -> None:
        self.close_calls += 1
        raise httpx.CloseError("transport-close-secret")
