from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta, timezone, tzinfo
from typing import cast
from uuid import UUID

import httpx
import pytest

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CaptureRequest
from eatbid.source.eat.http_client import (
    ACCEPT_HEADER,
    CONNECT_TIMEOUT_SECONDS,
    CONTENT_TYPE_HEADER,
    POOL_TIMEOUT_SECONDS,
    READ_TIMEOUT_SECONDS,
    USER_AGENT_HEADER,
    WRITE_TIMEOUT_SECONDS,
    EatHttpClient,
)
from eatbid.source.eat.registry import require

FETCHED_AT = datetime(2026, 9, 1, 3, 4, 5, tzinfo=UTC)


def _request(
    endpoint: str = "bid-detail", params: dict[str, str] | None = None
) -> CaptureRequest:
    return CaptureRequest(
        request_unit_id=1,
        run_id=UUID("00000000-0000-0000-0000-000000000001"),
        source="eat",
        endpoint=endpoint,
        params=params or {"ELCTRN_BID_ID": "5291468"},
    )


def _list_request(**overrides: str) -> CaptureRequest:
    params = {
        "P_BID_BGNG_DT": "20260801",
        "P_BID_END_DT": "20260831",
        "P_PRGRS_STAT_CD": "007",
        "P_CTPV_CD": "1",
        "START_PAGE": "1",
        "PAGE_SIZE": "1000",
    }
    params.update(overrides)
    return _request(endpoint="bid-list", params=params)


class _TrackingStream(httpx.SyncByteStream):
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


class _FailingStream(httpx.SyncByteStream):
    def __init__(self, upstream_error: httpx.HTTPError) -> None:
        self._upstream_error = upstream_error
        self.closed = False

    def __iter__(self) -> Iterator[bytes]:
        yield b"partial-source-bytes"
        raise self._upstream_error

    def close(self) -> None:
        self.closed = True


class _RecordingTransport(httpx.BaseTransport):
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


class _ExplodingTimezone(tzinfo):
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


def _raising_clock() -> datetime:
    raise RuntimeError("clock-provider-secret")


def test_unknown과_invalid_params는_warmup보다_먼저_요청_0건으로_거부한다() -> None:
    transport = _RecordingTransport(
        lambda request: httpx.Response(200, content=b"unused")
    )
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)
    cases = (
        _request(endpoint="contract-list"),
        _request(params={"ELCTRN_BID_ID": "1", "body": "raw"}),
        _request(params={"ELCTRN_BID_ID": ""}),
        CaptureRequest(1, UUID(int=1), "other", "bid-detail", {"ELCTRN_BID_ID": "1"}),
    )

    for request in cases:
        with pytest.raises(SourceContractError):
            client.fetch(request)

    assert transport.requests == []
    client.close()


@pytest.mark.parametrize(
    "capture_request",
    [
        _list_request(P_CTPV_CD="5"),
        _list_request(P_CTPV_CD="13"),
        _list_request(P_BID_BGNG_DT="20260901", P_BID_END_DT="20260831"),
        _list_request(PAGE_SIZE="1001"),
        _list_request(START_PAGE="1000001"),
        _request(params={"ELCTRN_BID_ID": "E230913-178198-0"}),
        _request(params={"ELCTRN_BID_ID": "0"}),
        _request(params={"ELCTRN_BID_ID": "05291468"}),
        _request(params={"ELCTRN_BID_ID": " 5291468"}),
        _request(params={"ELCTRN_BID_ID": "5291468\n"}),
        _request(params={"ELCTRN_BID_ID": "5291468\x00"}),
        _request(params={"ELCTRN_BID_ID": "5291468\x01"}),
        _request(params={"ELCTRN_BID_ID": "1<&"}),
        _request(params={"ELCTRN_BID_ID": "1" * 21}),
    ],
)
def test_source_unsafe_parameter는_validation_before_warmup으로_요청_0건이다(
    capture_request: CaptureRequest,
) -> None:
    transport = _RecordingTransport(lambda sent: httpx.Response(200, content=b"unused"))
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)

    with pytest.raises(SourceContractError, match="invalid-params"):
        client.fetch(capture_request)

    assert transport.requests == []
    client.close()


def test_region_18과_page_size_1000은_실제_요청_payload에_보존된다() -> None:
    transport = _RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        client.fetch(_list_request(P_CTPV_CD="18", PAGE_SIZE="1000"))

    payload = transport.requests[1].content
    assert b'<Col id="P_CTPV_CD">18</Col>' in payload
    assert b'<Col id="PAGE_SIZE">1000</Col>' in payload


def test_source_mismatch도_요청한_endpoint_slug만_안전하게_남긴다() -> None:
    transport = _RecordingTransport(
        lambda request: httpx.Response(200, content=b"unused")
    )
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)
    request = CaptureRequest(
        1,
        UUID(int=1),
        "other",
        "bid-detail",
        {"ELCTRN_BID_ID": "super-secret-id"},
    )

    with pytest.raises(SourceContractError) as caught:
        client.fetch(request)

    assert str(caught.value) == "eaT invalid-request [endpoint=bid-detail]"
    assert transport.requests == []
    client.close()


def test_fetch는_fixed_warmup과_검토된_POST를_같은_session에서_한번만_보낸다() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(200, content=b"<Root/>")

    transport = _RecordingTransport(handler)
    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        first = client.fetch(_request())
        second = client.fetch(_request(params={"ELCTRN_BID_ID": "5291469"}))

    assert [
        (request.method, request.url.host, request.url.path)
        for request in transport.requests
    ] == [
        ("GET", "ns.eat.co.kr", "/NeaT/eats/index.html"),
        ("POST", "ns.eat.co.kr", "/nm/ep/600/selectBidDtl.do"),
        ("POST", "ns.eat.co.kr", "/nm/ep/600/selectBidDtl.do"),
    ]
    post = transport.requests[1]
    assert post.headers["Accept"] == ACCEPT_HEADER
    assert post.headers["Content-Type"] == CONTENT_TYPE_HEADER
    assert post.headers["Origin"] == "https://ns.eat.co.kr"
    assert post.headers["Referer"] == "https://ns.eat.co.kr/NeaT/eats/index.html"
    assert post.headers["X-Requested-With"] == "XMLHttpRequest"
    assert post.headers["User-Agent"] == USER_AGENT_HEADER
    assert first.body == second.body == b"<Root/>"
    assert first.fetched_at == second.fetched_at == FETCHED_AT
    assert transport.closed


def test_fetch는_named_timeout을_모든_HTTP_phase에_고정한다() -> None:
    transport = _RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))
    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        client.fetch(_request())

    expected = {
        "connect": CONNECT_TIMEOUT_SECONDS,
        "read": READ_TIMEOUT_SECONDS,
        "write": WRITE_TIMEOUT_SECONDS,
        "pool": POOL_TIMEOUT_SECONDS,
    }
    assert all(
        request.extensions["timeout"] == expected for request in transport.requests
    )


@pytest.mark.parametrize("status_code", [302, 403, 429, 500])
def test_endpoint_non_2xx와_redirect는_body와_status를_그대로_반환한다(
    status_code: int,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(
            status_code,
            headers={"Location": "https://evil.example/leak"},
            content=b"source bytes first",
        )

    transport = _RecordingTransport(handler)
    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        response = client.fetch(_request())

    assert response.status_code == status_code
    assert response.body == b"source bytes first"
    assert response.fetched_at == FETCHED_AT
    assert len(transport.requests) == 2


@pytest.mark.parametrize("status_code", [302, 403, 500])
def test_warmup_non_2xx는_endpoint를_호출하지_않고_typed_failure로_끝난다(
    status_code: int,
) -> None:
    transport = _RecordingTransport(
        lambda request: httpx.Response(status_code, content=b"secret warmup body")
    )
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError, match="warmup-status") as caught,
    ):
        client.fetch(_request())

    assert len(transport.requests) == 1
    assert "secret warmup body" not in str(caught.value)


def test_streaming_byte_cap은_Content_Length를_믿지_않고_초과즉시_닫는다() -> None:
    ceiling = require("bid-detail").max_response_bytes
    stream = _TrackingStream(
        (b"a" * (ceiling // 2 + 1), b"b" * (ceiling // 2 + 1), b"never")
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(200, headers={"Content-Length": "1"}, stream=stream)

    transport = _RecordingTransport(handler)
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError, match="response-too-large"),
    ):
        client.fetch(_request())

    assert stream.yielded == 2
    assert stream.closed


def test_warmup도_streaming_byte_cap을_적용한다() -> None:
    from eatbid.source.eat.http_client import WARMUP_MAX_RESPONSE_BYTES

    stream = _TrackingStream((b"a" * (WARMUP_MAX_RESPONSE_BYTES + 1), b"never"))
    transport = _RecordingTransport(lambda request: httpx.Response(200, stream=stream))

    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError, match="warmup-response-too-large"),
    ):
        client.fetch(_request())

    assert len(transport.requests) == 1
    assert stream.yielded == 1
    assert stream.closed


@pytest.mark.parametrize(
    ("upstream_error", "category"),
    [
        (
            httpx.ConnectTimeout("https://secret.example/?token=abc"),
            "warmup-connect-timeout",
        ),
        (httpx.ReadTimeout("read-secret"), "warmup-read-timeout"),
        (httpx.WriteTimeout("write-secret"), "warmup-write-timeout"),
        (httpx.PoolTimeout("pool-secret"), "warmup-pool-timeout"),
        (httpx.ConnectError("cookie=session-secret"), "warmup-connect-error"),
        (httpx.ReadError("read-secret"), "warmup-read-error"),
        (httpx.WriteError("write-secret"), "warmup-write-error"),
        (httpx.CloseError("close-secret"), "warmup-close-error"),
        (
            httpx.ProtocolError("authorization=Bearer-secret"),
            "warmup-protocol-error",
        ),
        (httpx.DecodingError("compressed-body-secret"), "warmup-decoding-error"),
        (httpx.TransportError("fallback-secret"), "warmup-transport-error"),
    ],
)
def test_transport_error는_endpoint와_safe_category만_남기고_원인을_제거한다(
    upstream_error: httpx.HTTPError, category: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise upstream_error

    transport = _RecordingTransport(handler)
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError) as caught,
    ):
        client.fetch(_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "bid-detail" in rendered
    assert category in rendered
    assert "secret" not in rendered
    assert "token" not in rendered
    assert "cookie" not in rendered
    assert "authorization" not in rendered
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


@pytest.mark.parametrize(
    ("upstream_error", "category"),
    [
        (httpx.ReadError("midstream-read-secret"), "endpoint-read-error"),
        (
            httpx.DecodingError("midstream-decoding-secret"),
            "endpoint-decoding-error",
        ),
        (httpx.CloseError("midstream-close-secret"), "endpoint-close-error"),
    ],
)
def test_endpoint_midstream_failure는_retry없이_cookie_session과_stream_close를_보존한다(
    upstream_error: httpx.HTTPError, category: str
) -> None:
    stream = _FailingStream(upstream_error)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(
                200,
                headers={"Set-Cookie": "eat-session=warm-cookie; Path=/"},
                content=b"warm",
            )
        assert request.headers["Cookie"] == "eat-session=warm-cookie"
        return httpx.Response(200, stream=stream)

    transport = _RecordingTransport(handler)
    with (
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client,
        pytest.raises(SourceContractError) as caught,
    ):
        client.fetch(_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert category in rendered
    assert "secret" not in rendered
    assert len(transport.requests) == 2
    assert stream.closed
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


def test_injected_clock은_non_UTC를_UTC로_정규화하고_naive를_거부한다() -> None:
    kst = timezone(timedelta(hours=9))
    transport = _RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))
    with EatHttpClient(
        transport=transport,
        clock=lambda: datetime(2026, 9, 1, 12, 4, 5, tzinfo=kst),
    ) as client:
        assert client.fetch(_request()).fetched_at == FETCHED_AT

    naive_transport = _RecordingTransport(
        lambda request: httpx.Response(200, content=b"ok")
    )
    with (
        EatHttpClient(
            transport=naive_transport,
            clock=lambda: datetime(2026, 9, 1, 3, 4, 5),  # noqa: DTZ001
        ) as client,
        pytest.raises(SourceContractError, match="invalid-clock"),
    ):
        client.fetch(_request())


@pytest.mark.parametrize(
    "clock",
    [
        _raising_clock,
        cast(Callable[[], datetime], lambda: "clock-type-secret"),
        lambda: datetime(
            2026, 9, 1, 3, 4, 5, tzinfo=_ExplodingTimezone(fail_after_calls=0)
        ),
        lambda: datetime(
            2026, 9, 1, 3, 4, 5, tzinfo=_ExplodingTimezone(fail_after_calls=1)
        ),
    ],
)
def test_clock_provider와_timezone_failure는_전체_chain을_redact한다(
    clock: Callable[[], datetime],
) -> None:
    transport = _RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with (
        EatHttpClient(transport=transport, clock=clock) as client,
        pytest.raises(SourceContractError, match="invalid-clock") as caught,
    ):
        client.fetch(_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "secret" not in rendered
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


def test_context_manager는_소유한_transport를_닫는다() -> None:
    transport = _RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT):
        assert not transport.closed

    assert transport.closed


def test_close는_idempotent하고_이후_fetch를_HTTP전에_typed_failure로_거부한다() -> (
    None
):
    transport = _RecordingTransport(
        lambda request: httpx.Response(200, content=b"unused")
    )
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)

    client.close()
    client.close()
    with pytest.raises(SourceContractError, match="client-closed") as caught:
        client.fetch(_request())

    assert "bid-detail" in str(caught.value)
    assert transport.requests == []
    assert transport.close_calls == 1


def test_default_HTTP_transport는_TLS_certificate_verification을_유지한다() -> None:
    client = EatHttpClient(clock=lambda: FETCHED_AT)
    transport = cast(httpx.HTTPTransport, client._client._transport)
    ssl_context = transport._pool._ssl_context
    try:
        assert ssl_context.check_hostname
        assert ssl_context.verify_mode.name == "CERT_REQUIRED"
    finally:
        client.close()
