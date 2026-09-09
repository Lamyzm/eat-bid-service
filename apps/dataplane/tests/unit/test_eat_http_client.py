from __future__ import annotations

from typing import cast

import httpx
import pytest

from eatbid.failures.errors import SourceContractError
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

from .eat_http_test_support import (
    FETCHED_AT,
    RecordingSleeper,
    RecordingTransport,
    capture_request,
)


def test_fetch는_fixed_warmup과_검토된_POST를_같은_session에서_한번만_보낸다() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(200, content=b"<Root/>")

    transport = RecordingTransport(handler)
    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        first = client.fetch(capture_request())
        second = client.fetch(capture_request(params={"ELCTRN_BID_ID": "5291469"}))

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
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))
    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        client.fetch(capture_request())

    expected = {
        "connect": CONNECT_TIMEOUT_SECONDS,
        "read": READ_TIMEOUT_SECONDS,
        "write": WRITE_TIMEOUT_SECONDS,
        "pool": POOL_TIMEOUT_SECONDS,
    }
    assert all(request.extensions["timeout"] == expected for request in transport.requests)


@pytest.mark.parametrize(
    ("status_code", "expected_requests"),
    # 5xx만 일시 실패로 다시 보내고, 소진하면 마지막 응답을 그대로 capture에 넘긴다.
    [(302, 2), (403, 2), (429, 2), (500, 4)],
)
def test_endpoint_non_2xx와_redirect는_body와_status를_그대로_반환한다(
    status_code: int, expected_requests: int
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(
            status_code,
            headers={"Location": "https://evil.example/leak"},
            content=b"source bytes first",
        )

    transport = RecordingTransport(handler)
    with EatHttpClient(
        transport=transport, clock=lambda: FETCHED_AT, sleeper=RecordingSleeper()
    ) as client:
        response = client.fetch(capture_request())

    assert response.status_code == status_code
    assert response.body == b"source bytes first"
    assert response.fetched_at == FETCHED_AT
    assert len(transport.requests) == expected_requests


@pytest.mark.parametrize("status_code", [302, 403])
def test_warmup_non_2xx는_endpoint를_호출하지_않고_typed_failure로_끝난다(status_code: int) -> None:
    transport = RecordingTransport(
        lambda request: httpx.Response(status_code, content=b"secret warmup body")
    )
    with (
        EatHttpClient(
            transport=transport, clock=lambda: FETCHED_AT, sleeper=RecordingSleeper()
        ) as client,
        pytest.raises(SourceContractError, match="warmup-status") as caught,
    ):
        client.fetch(capture_request())

    assert len(transport.requests) == 1
    assert "secret warmup body" not in str(caught.value)


def test_default_HTTP_transport는_TLS_certificate_verification을_유지한다() -> None:
    client = EatHttpClient(clock=lambda: FETCHED_AT)
    transport = cast(httpx.HTTPTransport, client._client._transport)
    ssl_context = transport._pool._ssl_context
    try:
        assert ssl_context.check_hostname
        assert ssl_context.verify_mode.name == "CERT_REQUIRED"
    finally:
        client.close()
