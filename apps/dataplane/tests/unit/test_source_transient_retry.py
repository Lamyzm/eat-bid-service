from __future__ import annotations

from datetime import timedelta

import httpx
import pytest

from eatbid.cli import exit_code_for_error
from eatbid.failures.errors import SourceContractError, SourceUnavailableError
from eatbid.source.eat.http_client import EatHttpClient
from eatbid.source.retry import TransientRetryPolicy

from .eat_http_test_support import (
    FETCHED_AT,
    FailingStream,
    RecordingSleeper,
    RecordingTransport,
    SequencedTransport,
    capture_request,
)

정책 = TransientRetryPolicy(
    max_attempts=3,
    initial_backoff=timedelta(seconds=1),
    backoff_multiplier=2,
    max_total_backoff=timedelta(seconds=30),
)


def test_warmup_연결이_두번_끊겨도_재시도_뒤_capture가_성공한다() -> None:
    sleeper = RecordingSleeper()
    transport = SequencedTransport(
        (
            httpx.ConnectError("host-secret"),
            httpx.ConnectError("host-secret"),
            200,
        ),
        body=b"<Root/>",
    )

    with EatHttpClient(
        transport=transport,
        clock=lambda: FETCHED_AT,
        retry_policy=정책,
        sleeper=sleeper,
    ) as client:
        response = client.fetch(capture_request())

    assert response.status_code == 200
    assert response.body == b"<Root/>"
    # warmup 3회(2회 실패 + 성공) 뒤 endpoint 1회다.
    assert len(transport.requests) == 4
    assert sleeper.delays == [timedelta(seconds=1), timedelta(seconds=2)]


def test_재시도를_소진한_연결실패는_일시장애_카테고리와_exit_69로_끝난다() -> None:
    sleeper = RecordingSleeper()
    transport = SequencedTransport((httpx.ConnectError("host-secret"),))

    with (
        EatHttpClient(
            transport=transport,
            clock=lambda: FETCHED_AT,
            retry_policy=정책,
            sleeper=sleeper,
        ) as client,
        pytest.raises(SourceUnavailableError) as caught,
    ):
        client.fetch(capture_request())

    rendered = f"{caught.value!s} {caught.value!r}"
    assert "warmup-connect-error" in rendered
    assert "attempts=3" in rendered
    assert "secret" not in rendered
    assert caught.value.attempts == 3
    assert len(transport.requests) == 3
    assert exit_code_for_error(caught.value) == 69
    assert not isinstance(caught.value, SourceContractError)


def test_warmup_403은_재시도하지_않고_계약_실패로_끝난다() -> None:
    sleeper = RecordingSleeper()
    transport = SequencedTransport((403,), body=b"blocked")

    with (
        EatHttpClient(
            transport=transport,
            clock=lambda: FETCHED_AT,
            retry_policy=정책,
            sleeper=sleeper,
        ) as client,
        pytest.raises(SourceContractError, match="warmup-status"),
    ):
        client.fetch(capture_request())

    assert len(transport.requests) == 1
    assert sleeper.delays == []


def test_endpoint_403은_재시도하지_않고_body를_그대로_돌려준다() -> None:
    sleeper = RecordingSleeper()
    transport = SequencedTransport((200, 403), body=b"blocked")

    with EatHttpClient(
        transport=transport,
        clock=lambda: FETCHED_AT,
        retry_policy=정책,
        sleeper=sleeper,
    ) as client:
        response = client.fetch(capture_request())

    assert (response.status_code, response.body) == (403, b"blocked")
    assert len(transport.requests) == 2
    assert sleeper.delays == []


def test_endpoint_5xx는_재시도하고_소진하면_마지막_응답을_보존한다() -> None:
    sleeper = RecordingSleeper()
    transport = SequencedTransport((200, 503), body=b"upstream failed")

    with EatHttpClient(
        transport=transport,
        clock=lambda: FETCHED_AT,
        retry_policy=정책,
        sleeper=sleeper,
    ) as client:
        response = client.fetch(capture_request())

    # 원본을 남길 응답이 있으므로 계약 분류는 capture 단계가 하고 여기서는 관측을 버리지 않는다.
    assert (response.status_code, response.body) == (503, b"upstream failed")
    assert len(transport.requests) == 4
    assert sleeper.delays == [timedelta(seconds=1), timedelta(seconds=2)]


def test_warmup_5xx는_소진하면_남길_관측이_없어_일시장애가_된다() -> None:
    transport = SequencedTransport((503,), body=b"secret warmup body")

    with (
        EatHttpClient(
            transport=transport,
            clock=lambda: FETCHED_AT,
            retry_policy=정책,
            sleeper=RecordingSleeper(),
        ) as client,
        pytest.raises(SourceUnavailableError) as caught,
    ):
        client.fetch(capture_request())

    assert "warmup-status" in str(caught.value)
    assert "secret warmup body" not in str(caught.value)
    assert len(transport.requests) == 3
    assert exit_code_for_error(caught.value) == 69


def test_midstream_전송실패는_재시도하지_않고_계약_실패로_남는다() -> None:
    sleeper = RecordingSleeper()
    stream = FailingStream(httpx.ReadError("midstream-secret"))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, content=b"warm")
        return httpx.Response(200, stream=stream)

    transport = RecordingTransport(handler)
    with (
        EatHttpClient(
            transport=transport,
            clock=lambda: FETCHED_AT,
            retry_policy=정책,
            sleeper=sleeper,
        ) as client,
        pytest.raises(SourceContractError, match="endpoint-read-error"),
    ):
        client.fetch(capture_request())

    assert len(transport.requests) == 2
    assert sleeper.delays == []


@pytest.mark.parametrize(
    ("max_attempts", "initial", "multiplier", "budget"),
    [
        (3, 1, 2, 30),
        (5, 2, 3, 10),
        (10, 1, 2, 60),
        (1, 5, 2, 30),
        (4, 0, 2, 0),
    ],
)
def test_backoff_합은_설정한_상한을_넘지_않는다(
    max_attempts: int, initial: int, multiplier: int, budget: int
) -> None:
    policy = TransientRetryPolicy(
        max_attempts=max_attempts,
        initial_backoff=timedelta(seconds=initial),
        backoff_multiplier=multiplier,
        max_total_backoff=timedelta(seconds=budget),
    )

    delays = policy.backoff_delays()

    assert len(delays) <= max_attempts - 1
    assert sum(delays, timedelta(0)) <= timedelta(seconds=budget)
    assert all(delay >= timedelta(0) for delay in delays)


def test_예산이_바닥나면_남은_시도를_대기없이_열지_않는다() -> None:
    policy = TransientRetryPolicy(
        max_attempts=5,
        initial_backoff=timedelta(seconds=4),
        backoff_multiplier=2,
        max_total_backoff=timedelta(seconds=5),
    )

    assert policy.backoff_delays() == (timedelta(seconds=4), timedelta(seconds=1))


@pytest.mark.parametrize(
    "invalid",
    [
        {"max_attempts": 0},
        {"backoff_multiplier": 0},
        {"initial_backoff": timedelta(seconds=-1)},
        {"max_total_backoff": timedelta(seconds=-1)},
    ],
)
def test_재시도_정책이_말이_되지_않는_값을_거부한다(invalid: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        TransientRetryPolicy(**invalid)  # pyright: ignore[reportArgumentType]
