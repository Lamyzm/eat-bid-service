"""모듈 책임: eaT HTTP 왕복 한 번을 실행하고 응답이 오지 않은 일시 실패만 상한 안에서 다시 보낸다."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

import httpx

from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.source.retry import (
    DEFAULT_TRANSIENT_RETRY_POLICY,
    TRANSIENT_TRANSPORT_CATEGORIES,
    Sleeper,
    TransientRetryPolicy,
    is_transient_status,
    sleep_between_attempts,
)

_TRANSPORT_ERROR_CATEGORIES: tuple[tuple[type[httpx.HTTPError], str], ...] = (
    (httpx.ConnectTimeout, "connect-timeout"),
    (httpx.ReadTimeout, "read-timeout"),
    (httpx.WriteTimeout, "write-timeout"),
    (httpx.PoolTimeout, "pool-timeout"),
    (httpx.ConnectError, "connect-error"),
    (httpx.ReadError, "read-error"),
    (httpx.WriteError, "write-error"),
    (httpx.CloseError, "close-error"),
    (httpx.ProtocolError, "protocol-error"),
    (httpx.DecodingError, "decoding-error"),
    (httpx.TransportError, "transport-error"),
)


class _ResponseTooLarge(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ExchangeOutcome:
    """왜: 몇 번째 시도에서 받은 응답인지는 해석이 아니라 관측이다. 같은 200이라도 재시도로 얻은
    것인지 구분해야 소스 불안정을 사후에 세어 볼 수 있어 응답과 같은 자리에 남긴다."""

    status_code: int
    body: bytes
    attempts: int


@dataclass(frozen=True, slots=True)
class _AttemptFailure:
    category: str
    retryable: bool


class EatExchange:
    """왜: 재시도는 이 한 곳에서만 일어난다. WorkflowTemplate에는 의도적으로 `retryStrategy`가
    없고 source semaphore가 소스 호출을 pod 하나로 직렬화하므로, 일시 실패를 다시 보낼 수 있는
    유일한 자리가 semaphore 안에서 도는 이 프로세스다."""

    def __init__(
        self,
        client: httpx.Client,
        *,
        retry_policy: TransientRetryPolicy = DEFAULT_TRANSIENT_RETRY_POLICY,
        sleeper: Sleeper = sleep_between_attempts,
    ) -> None:
        self._client = client
        self._retry_policy = retry_policy
        self._sleeper = sleeper

    def run(
        self,
        *,
        endpoint: str,
        phase: str,
        method: str,
        url: str,
        headers: Mapping[str, str],
        content: bytes | None,
        max_response_bytes: int,
    ) -> ExchangeOutcome:
        delays = self._retry_policy.backoff_delays()
        for attempt in range(1, len(delays) + 2):
            final = attempt > len(delays)
            result, failure = self._attempt(
                phase=phase,
                method=method,
                url=url,
                headers=headers,
                content=content,
                max_response_bytes=max_response_bytes,
            )
            if result is not None and (final or not is_transient_status(result[0])):
                return ExchangeOutcome(result[0], result[1], attempt)
            if failure is not None and (final or not failure.retryable):
                raise self._terminal(endpoint, failure, attempt) from None
            self._sleeper(delays[attempt - 1])
        # pragma: no cover - 위 loop는 항상 결과나 typed failure로 끝난다.
        raise RuntimeError("eaT exchange did not produce a result")

    def _attempt(
        self,
        *,
        phase: str,
        method: str,
        url: str,
        headers: Mapping[str, str],
        content: bytes | None,
        max_response_bytes: int,
    ) -> tuple[tuple[int, bytes] | None, _AttemptFailure | None]:
        streaming = False
        try:
            with self._client.stream(
                method, url, headers=headers, content=content
            ) as response:
                # 왜: 여기부터는 소스가 이미 응답을 흘리기 시작했다. 중간에 끊긴 전송을 다시 보내면
                # 같은 크기의 응답을 한 번 더 소스에 요구하므로 재시도 대상에서 뺀다.
                streaming = True
                body = _read_limited(response, max_response_bytes)
                return (response.status_code, body), None
        except httpx.HTTPError as error:
            category = _transport_error_category(error)
            return None, _AttemptFailure(
                f"{phase}-{category}",
                not streaming and category in TRANSIENT_TRANSPORT_CATEGORIES,
            )
        except _ResponseTooLarge:
            category = (
                "warmup-response-too-large"
                if phase == "warmup"
                else "response-too-large"
            )
            return None, _AttemptFailure(category, False)

    @staticmethod
    def _terminal(
        endpoint: str, failure: _AttemptFailure, attempts: int
    ) -> SourceContractError | SourceUnavailableError:
        detail = f"endpoint={endpoint} category={failure.category}"
        if failure.retryable:
            return SourceUnavailableError(
                f"eaT request failed [{detail} attempts={attempts}]", attempts=attempts
            )
        return SourceContractError(f"eaT request failed [{detail}]")


def _read_limited(response: httpx.Response, max_response_bytes: int) -> bytes:
    chunks: list[bytes] = []
    total_bytes = 0
    for chunk in response.iter_bytes():
        total_bytes += len(chunk)
        if total_bytes > max_response_bytes:
            raise _ResponseTooLarge
        chunks.append(chunk)
    return b"".join(chunks)


def _transport_error_category(error: httpx.HTTPError) -> str:
    for error_type, category in _TRANSPORT_ERROR_CATEGORIES:
        if isinstance(error, error_type):
            return category
    return "request-error"
