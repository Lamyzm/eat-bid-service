from __future__ import annotations

from uuid import UUID

import httpx
import pytest

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CaptureRequest
from eatbid.source.eat.http_client import EatHttpClient

from .eat_http_test_support import (
    FETCHED_AT,
    RecordingTransport,
    capture_request,
    list_request,
)


def test_unknown과_invalid_params는_warmup보다_먼저_요청_0건으로_거부한다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"unused"))
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)
    cases = (
        capture_request(endpoint="contract-list"),
        capture_request(params={"ELCTRN_BID_ID": "1", "body": "raw"}),
        capture_request(params={"ELCTRN_BID_ID": ""}),
        CaptureRequest(1, UUID(int=1), "other", "bid-detail", {"ELCTRN_BID_ID": "1"}),
    )

    for request in cases:
        with pytest.raises(SourceContractError):
            client.fetch(request)

    assert transport.requests == []
    client.close()


@pytest.mark.parametrize(
    "capture_request_case",
    [
        list_request(P_CTPV_CD="5"),
        list_request(P_CTPV_CD="13"),
        list_request(P_BID_BGNG_DT="20260901", P_BID_END_DT="20260831"),
        list_request(PAGE_SIZE="1001"),
        list_request(START_PAGE="1000001"),
        capture_request(params={"ELCTRN_BID_ID": "E230913-178198-0"}),
        capture_request(params={"ELCTRN_BID_ID": "0"}),
        capture_request(params={"ELCTRN_BID_ID": "05291468"}),
        capture_request(params={"ELCTRN_BID_ID": " 5291468"}),
        capture_request(params={"ELCTRN_BID_ID": "5291468\n"}),
        capture_request(params={"ELCTRN_BID_ID": "5291468\x00"}),
        capture_request(params={"ELCTRN_BID_ID": "5291468\x01"}),
        capture_request(params={"ELCTRN_BID_ID": "1<&"}),
        capture_request(params={"ELCTRN_BID_ID": "1" * 21}),
    ],
)
def test_source_unsafe_parameter는_validation_before_warmup으로_요청_0건이다(
    capture_request_case: CaptureRequest,
) -> None:
    transport = RecordingTransport(lambda sent: httpx.Response(200, content=b"unused"))
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)

    with pytest.raises(SourceContractError, match="invalid-params"):
        client.fetch(capture_request_case)

    assert transport.requests == []
    client.close()


def test_region_18과_page_size_1000은_실제_요청_payload에_보존된다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT) as client:
        client.fetch(list_request(P_CTPV_CD="18", PAGE_SIZE="1000"))

    payload = transport.requests[1].content
    assert b'<Col id="P_CTPV_CD">18</Col>' in payload
    assert b'<Col id="PAGE_SIZE">1000</Col>' in payload


def test_source_mismatch도_요청한_endpoint_slug만_안전하게_남긴다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"unused"))
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
