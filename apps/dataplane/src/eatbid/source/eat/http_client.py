"""모듈 책임: 검토된 eaT 계약만 fixed HTTP session으로 호출해 원본 응답 bytes를 반환한다."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from enum import Enum, auto
from types import TracebackType
from typing import Self

import httpx

from eatbid.errors import SourceContractError, SourceUnavailableError
from eatbid.ingest.models import CaptureRequest
from eatbid.source.client import SourceResponse
from eatbid.source.eat.exchange import EatExchange
from eatbid.source.eat.registry import (
    EAT_ORIGIN,
    EatEndpointTransport,
    require_transport,
)
from eatbid.source.retry import (
    DEFAULT_TRANSIENT_RETRY_POLICY,
    Sleeper,
    TransientRetryPolicy,
    is_transient_status,
    sleep_between_attempts,
)

CONNECT_TIMEOUT_SECONDS = 10.0
READ_TIMEOUT_SECONDS = 30.0
WRITE_TIMEOUT_SECONDS = 10.0
POOL_TIMEOUT_SECONDS = 10.0
WARMUP_MAX_RESPONSE_BYTES = 2 * 1024 * 1024
WARMUP_PATH = "/NeaT/eats/index.html"
ACCEPT_HEADER = "application/xml, text/xml, */*; q=0.01"
CONTENT_TYPE_HEADER = "application/xml; charset=UTF-8"
USER_AGENT_HEADER = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)

_TIMEOUT = httpx.Timeout(
    connect=CONNECT_TIMEOUT_SECONDS,
    read=READ_TIMEOUT_SECONDS,
    write=WRITE_TIMEOUT_SECONDS,
    pool=POOL_TIMEOUT_SECONDS,
)
_ENDPOINT_HEADERS = {
    "Accept": ACCEPT_HEADER,
    "Content-Type": CONTENT_TYPE_HEADER,
    "Origin": EAT_ORIGIN,
    "Referer": f"{EAT_ORIGIN}{WARMUP_PATH}",
    "User-Agent": USER_AGENT_HEADER,
    "X-Requested-With": "XMLHttpRequest",
}
_WARMUP_HEADERS = {"User-Agent": USER_AGENT_HEADER}


class _ClientLifecycle(Enum):
    OPEN = auto()
    CLOSING = auto()
    CLOSED = auto()
    CLOSE_FAILED = auto()


def _system_utc_clock() -> datetime:
    return datetime.now(UTC)


class EatHttpClient:
    def __init__(
        self,
        *,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], datetime] = _system_utc_clock,
        timeout: httpx.Timeout = _TIMEOUT,
        retry_policy: TransientRetryPolicy = DEFAULT_TRANSIENT_RETRY_POLICY,
        sleeper: Sleeper = sleep_between_attempts,
    ) -> None:
        self._clock = clock
        # verify 인자를 노출하거나 덮어쓰지 않아 httpx의 CA 검증 기본값을 유지한다.
        self._client = httpx.Client(
            timeout=timeout,
            follow_redirects=False,
            transport=transport,
        )
        self._exchange = EatExchange(
            self._client, retry_policy=retry_policy, sleeper=sleeper
        )
        self._warmed = False
        self._lifecycle = _ClientLifecycle.OPEN

    def fetch(self, request: CaptureRequest) -> SourceResponse:
        if self._lifecycle is not _ClientLifecycle.OPEN:
            endpoint = (
                request.endpoint if isinstance(request, CaptureRequest) else "unknown"
            )
            category = (
                "client-close-failed"
                if self._lifecycle is _ClientLifecycle.CLOSE_FAILED
                else "client-closed"
            )
            raise self._failure(endpoint, category)
        transport, payload = self._prepare(request)
        self._ensure_warmup(transport.endpoint)
        # 왜: endpoint 응답은 status와 무관하게 capture가 raw로 보존한다. 재시도로도 5xx가 계속되면
        # 그 마지막 응답을 그대로 넘겨 관측을 남기고, 해석은 capture 단계 분류에 맡긴다.
        outcome = self._exchange.run(
            endpoint=transport.endpoint,
            phase="endpoint",
            method=transport.method,
            url=f"{transport.origin}{transport.path}",
            headers=_ENDPOINT_HEADERS,
            content=payload,
            max_response_bytes=transport.max_response_bytes,
        )
        return SourceResponse(
            outcome.status_code, outcome.body, self._fetched_at(transport.endpoint)
        )

    def _prepare(self, request: CaptureRequest) -> tuple[EatEndpointTransport, bytes]:
        if not isinstance(request, CaptureRequest):
            raise SourceContractError("eaT invalid-request [endpoint=unknown]")
        if request.source != "eat":
            raise SourceContractError(
                f"eaT invalid-request [endpoint={request.endpoint}]"
            )
        # capture 경계는 응답을 어떤 parser version으로 읽을지 모른다. 요청을 보내는 데 필요한 것은
        # 전송 계약뿐이고, 해석 계약은 normalize 단계가 자기 실행 단위의 version으로 고른다.
        transport = require_transport(request.endpoint)
        return transport, transport.build_payload(request.params)

    def _ensure_warmup(self, endpoint: str) -> None:
        if self._warmed:
            return
        outcome = self._exchange.run(
            endpoint=endpoint,
            phase="warmup",
            method="GET",
            url=f"{EAT_ORIGIN}{WARMUP_PATH}",
            headers=_WARMUP_HEADERS,
            content=None,
            max_response_bytes=WARMUP_MAX_RESPONSE_BYTES,
        )
        if is_transient_status(outcome.status_code):
            # 왜: warmup 응답은 어디에도 보존하지 않는다. 재시도까지 소진한 5xx는 남길 관측이 없는
            # 소스 장애이므로 계약 위반이 아니라 일시 장애로 닫아 exit code를 구분한다.
            raise SourceUnavailableError(
                f"eaT request failed [endpoint={endpoint} category=warmup-status "
                f"attempts={outcome.attempts}]",
                attempts=outcome.attempts,
            ) from None
        if not 200 <= outcome.status_code < 300:
            raise SourceContractError(
                f"eaT request failed [endpoint={endpoint} category=warmup-status]",
                status_code=outcome.status_code,
            )
        self._warmed = True

    @staticmethod
    def _failure(endpoint: str, category: str) -> SourceContractError:
        return SourceContractError(
            f"eaT request failed [endpoint={endpoint} category={category}]"
        )

    def _fetched_at(self, endpoint: str) -> datetime:
        safe_error: SourceContractError | None = None
        normalized: datetime | None = None
        try:
            fetched_at = self._clock()
            if not isinstance(fetched_at, datetime) or fetched_at.utcoffset() is None:
                raise ValueError("clock must return an aware datetime")
            provider_normalized = fetched_at.astimezone(UTC)
            first_offset = provider_normalized.utcoffset()
            second_offset = provider_normalized.utcoffset()
            if first_offset != timedelta(0) or second_offset != first_offset:
                raise ValueError("clock normalization must produce UTC")
            # datetime subclass와 provider tzinfo를 primitive 값에서 다시 만들어 완전히 분리한다.
            normalized = datetime(
                provider_normalized.year,
                provider_normalized.month,
                provider_normalized.day,
                provider_normalized.hour,
                provider_normalized.minute,
                provider_normalized.second,
                provider_normalized.microsecond,
                tzinfo=UTC,
                fold=provider_normalized.fold,
            )
        except Exception:  # noqa: BLE001 - clock/tzinfo provider detail은 노출하지 않는다.
            safe_error = self._failure(endpoint, "invalid-clock")
        if safe_error is not None:
            raise safe_error from None
        if (
            normalized is None
        ):  # pragma: no cover - 위 경계가 결과 또는 typed error를 만든다.
            raise RuntimeError("eaT clock did not produce a result")
        return normalized

    def close(self) -> None:
        if self._lifecycle is _ClientLifecycle.CLOSED:
            return
        if self._lifecycle is _ClientLifecycle.CLOSE_FAILED:
            raise self._failure("session", "client-close-error") from None
        if self._lifecycle is _ClientLifecycle.CLOSING:
            raise self._failure("session", "client-close-in-progress") from None

        self._lifecycle = _ClientLifecycle.CLOSING
        safe_error: SourceContractError | None = None
        try:
            self._client.close()
        except Exception:  # noqa: BLE001 - transport close detail은 lifecycle 밖에 노출하지 않는다.
            # httpx session은 이미 closed일 수 있어 재호출하지 않는 terminal failed 정책이다.
            self._lifecycle = _ClientLifecycle.CLOSE_FAILED
            safe_error = self._failure("session", "client-close-error")
        else:
            self._lifecycle = _ClientLifecycle.CLOSED
        if safe_error is not None:
            raise safe_error from None

    def __enter__(self) -> Self:
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        try:
            self.close()
        except SourceContractError:
            if exc_value is None:
                raise
            # body exception이 원인 권위를 가지며 close failure는 terminal state에 남는다.
