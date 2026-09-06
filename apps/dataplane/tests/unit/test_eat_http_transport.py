from __future__ import annotations

import httpx
import pytest

from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.source.eat.http_client import WARMUP_MAX_RESPONSE_BYTES, EatHttpClient
from eatbid.source.eat.registry import require_transport

from .eat_http_test_support import (
    FETCHED_AT,
    FailingStream,
    RecordingSleeper,
    RecordingTransport,
    TrackingStream,
    capture_request,
)


def test_streaming_byte_cap은_Content_Length를_믿지_않고_초과즉시_닫는다() -> None:
    ceiling = require_transport("bid-detail").max_response_bytes
    stream = TrackingStream(
        (b"a" * (ceiling // 2 + 1), b"b" * (ceiling // 2 + 1), b"never")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(200, headers={"Content-Length": "1"}, stream=stream)

    transport = RecordingTransport(handler)
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError, match="response-too-large"),
    ):
        client.fetch(capture_request())

    assert stream.yielded == 2
    assert stream.closed


def test_warmup도_streaming_byte_cap을_적용한다() -> None:
    stream = TrackingStream((b"a" * (WARMUP_MAX_RESPONSE_BYTES + 1), b"never"))
    transport = RecordingTransport(lambda request: httpx.Response(200, stream=stream))

    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError, match="warmup-response-too-large"),
    ):
        client.fetch(capture_request())

    assert len(transport.requests) == 1
    assert stream.yielded == 1
    assert stream.closed


@pytest.mark.parametrize(
    ("upstream_error", "category", "error_type"),
    [
        (httpx.ConnectTimeout("url-secret"), "warmup-connect-timeout", SourceUnavailableError),
        (httpx.ReadTimeout("read-secret"), "warmup-read-timeout", SourceUnavailableError),
        (httpx.WriteTimeout("write-secret"), "warmup-write-timeout", SourceUnavailableError),
        (httpx.PoolTimeout("pool-secret"), "warmup-pool-timeout", SourceUnavailableError),
        (httpx.ConnectError("cookie-secret"), "warmup-connect-error", SourceUnavailableError),
        (httpx.ReadError("read-secret"), "warmup-read-error", SourceUnavailableError),
        (httpx.WriteError("write-secret"), "warmup-write-error", SourceUnavailableError),
        (httpx.CloseError("close-secret"), "warmup-close-error", SourceUnavailableError),
        (httpx.ProtocolError("authorization-secret"), "warmup-protocol-error", SourceUnavailableError),
        # 응답을 다 받은 뒤의 decoding 실패는 다시 보내도 같은 결론이라 계약 위반으로 남는다.
        (httpx.DecodingError("body-secret"), "warmup-decoding-error", SourceContractError),
        (httpx.TransportError("fallback-secret"), "warmup-transport-error", SourceUnavailableError),
    ],
)
def test_transport_error는_endpoint와_safe_category만_남기고_원인을_제거한다(
    upstream_error: httpx.HTTPError, category: str, error_type: type[Exception]
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise upstream_error

    transport = RecordingTransport(handler)
    with (
        EatHttpClient(
            transport=transport,
            clock=lambda: FETCHED_AT,
            sleeper=RecordingSleeper(),
        ) as client,
        pytest.raises(error_type) as caught,
    ):
        client.fetch(capture_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "bid-detail" in rendered
    assert category in rendered
    assert "secret" not in rendered
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


@pytest.mark.parametrize(
    ("upstream_error", "category"),
    [
        (httpx.ReadError("midstream-read-secret"), "endpoint-read-error"),
        (httpx.DecodingError("midstream-decoding-secret"), "endpoint-decoding-error"),
        (httpx.CloseError("midstream-close-secret"), "endpoint-close-error"),
    ],
)
def test_endpoint_midstream_failure는_retry없이_cookie_session과_stream_close를_보존한다(
    upstream_error: httpx.HTTPError, category: str
) -> None:
    stream = FailingStream(upstream_error)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                headers={"Set-Cookie": "eat-session=warm-cookie; Path=/"},
                content=b"warm",
            )
        assert request.headers["Cookie"] == "eat-session=warm-cookie"
        return httpx.Response(200, stream=stream)

    transport = RecordingTransport(handler)
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError) as caught,
    ):
        client.fetch(capture_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert category in rendered
    assert "secret" not in rendered
    assert len(transport.requests) == 2
    assert stream.closed
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
