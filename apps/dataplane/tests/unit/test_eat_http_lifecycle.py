from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from typing import cast

import httpx
import pytest

from eatbid.failures.errors import SourceContractError
from eatbid.source.eat.http_client import EatHttpClient

from .eat_http_test_support import (
    FETCHED_AT,
    ExplodingTimezone,
    FailingCloseTransport,
    RecordingTransport,
    RepeatedOffsetAdversarialDatetime,
    capture_request,
    raising_clock,
)


def test_injected_clock은_non_UTC를_UTC로_정규화하고_naive를_거부한다() -> None:
    kst = timezone(timedelta(hours=9))
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))
    with EatHttpClient(
        transport=transport,
        clock=lambda: datetime(2026, 9, 1, 12, 4, 5, tzinfo=kst),
    ) as client:
        assert client.fetch(capture_request()).fetched_at == FETCHED_AT

    naive_transport = RecordingTransport(
        lambda request: httpx.Response(200, content=b"ok")
    )
    with (
        EatHttpClient(
            transport=naive_transport,
            clock=lambda: datetime(2026, 9, 1, 3, 4, 5),  # noqa: DTZ001
        ) as client,
        pytest.raises(SourceContractError, match="invalid-clock"),
    ):
        client.fetch(capture_request())


@pytest.mark.parametrize(
    "clock",
    [
        raising_clock,
        cast(Callable[[], datetime], lambda: "clock-type-secret"),
        lambda: datetime(
            2026, 9, 1, 3, 4, 5, tzinfo=ExplodingTimezone(fail_after_calls=0)
        ),
        lambda: datetime(
            2026, 9, 1, 3, 4, 5, tzinfo=ExplodingTimezone(fail_after_calls=1)
        ),
    ],
)
def test_clock_provider와_timezone_failure는_전체_chain을_redact한다(
    clock: Callable[[], datetime],
) -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with (
        EatHttpClient(transport=transport, clock=clock) as client,
        pytest.raises(SourceContractError, match="invalid-clock") as caught,
    ):
        client.fetch(capture_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "secret" not in rendered
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


def test_datetime_subclass의_반복_timezone_failure도_SourceResponse_밖으로_새지_않는다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with (
        EatHttpClient(
            transport=transport,
            clock=RepeatedOffsetAdversarialDatetime,
        ) as client,
        pytest.raises(SourceContractError, match="invalid-clock") as caught,
    ):
        client.fetch(capture_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "secret" not in rendered
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None


def test_context_manager는_소유한_transport를_닫는다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"ok"))

    with EatHttpClient(transport=transport, clock=lambda: FETCHED_AT):
        assert not transport.closed

    assert transport.closed


def test_close는_idempotent하고_이후_fetch를_HTTP전에_typed_failure로_거부한다() -> None:
    transport = RecordingTransport(lambda request: httpx.Response(200, content=b"unused"))
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)

    client.close()
    client.close()
    with pytest.raises(SourceContractError, match="client-closed") as caught:
        client.fetch(capture_request())

    assert "bid-detail" in str(caught.value)
    assert transport.requests == []
    assert transport.close_calls == 1


def test_explicit_close_failure는_terminal_failed_state로_redact되고_재시도하지_않는다() -> None:
    transport = FailingCloseTransport(
        lambda request: httpx.Response(200, content=b"unused")
    )
    client = EatHttpClient(transport=transport, clock=lambda: FETCHED_AT)

    with pytest.raises(SourceContractError, match="client-close-error") as first:
        client.close()
    with pytest.raises(SourceContractError, match="client-close-error") as second:
        client.close()
    with pytest.raises(SourceContractError, match="client-close-failed"):
        client.fetch(capture_request())

    for caught in (first, second):
        rendered = f"{caught.value!s} {caught.value!r}"
        assert "secret" not in rendered
        assert caught.value.__cause__ is None
        assert caught.value.__context__ is None
    assert transport.close_calls == 1
    assert transport.requests == []


def test_context_exit의_close_failure는_활성_body_exception을_대체하지_않는다() -> None:
    transport = FailingCloseTransport(
        lambda request: httpx.Response(200, content=b"unused")
    )

    with (
        pytest.raises(ValueError, match="body-failure") as caught,
        EatHttpClient(transport=transport, clock=lambda: FETCHED_AT),
    ):
        raise ValueError("body-failure")

    assert str(caught.value) == "body-failure"
    assert caught.value.__cause__ is None
    assert caught.value.__context__ is None
    assert transport.close_calls == 1
