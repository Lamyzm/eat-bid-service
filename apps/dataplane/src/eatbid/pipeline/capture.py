"""모듈 책임: source 응답을 raw object와 observation 순서로 보존한 뒤 실패를 분류한다."""

from __future__ import annotations

from eatbid.failures.categories import SOURCE_CONTRACT, SOURCE_THROTTLED
from eatbid.failures.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest
from eatbid.ingest.repository import IngestRepository
from eatbid.source.client import SourceClient, SourceResponse
from eatbid.storage.object_store import RawObjectStore, raw_content_sha256

__all__ = [
    "SOURCE_CONTRACT",
    "SOURCE_THROTTLED",
    "CaptureReservationReleaseError",
    "SourceCaptureError",
    "SourceThrottledError",
    "capture",
    "capture_response",
]


class SourceCaptureError(RuntimeError):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"source returned HTTP {status_code}")
        self.status_code = status_code


class SourceThrottledError(SourceCaptureError):
    """The source rejected or throttled the request."""


class CaptureReservationReleaseError(RuntimeError):
    """reservation cleanup 실패를 provider 상세 없이 terminal로 닫는다."""


def capture(
    request: CaptureRequest,
    store: RawObjectStore,
    repository: IngestRepository,
    client: SourceClient,
) -> CapturedObservation:
    # 왜 fetch 전에 ledger를 보나. 실패한 chunk를 다시 돌리는 재시도는 세계를 다시 관측하는 것이
    # 아니라 못 받은 건을 마저 받는 일이다. 이미 받은 건까지 다시 부르면 재시도 비용이 chunk 전체가
    # 되고, 응답 뒤의 reserve가 어차피 기존 관측을 돌려주므로 호출만 낭비된다(EAT-122).
    existing = repository.find_captured_observation(request=request)
    if existing is not None:
        return existing
    response = client.fetch(request)
    return capture_response(request, response, store, repository)


def capture_response(
    request: CaptureRequest,
    response: SourceResponse,
    store: RawObjectStore,
    repository: IngestRepository,
) -> CapturedObservation:
    """왜: 이미 받은 응답도 archive→observation 순서를 우회하지 못하게 한다."""
    if not isinstance(response, SourceResponse):
        raise TypeError("source client must return SourceResponse")
    existing = repository.reserve_capture(
        request=request, response=response,
        content_sha256=raw_content_sha256(response.body),
    )
    body_error: Exception | None = None
    release_failed = False
    observation: CapturedObservation
    try:
        if existing is not None:
            observation = existing
        else:
            stored = store.put(
                source=request.source, endpoint=request.endpoint, body=response.body,
            )
            failure_category = _failure_category(response.status_code)
            observation = repository.record_observation(
                request=request, response=response, stored=stored,
                failure_category=failure_category,
            )
            if failure_category == SOURCE_THROTTLED:
                raise SourceThrottledError(response.status_code)
            if failure_category == SOURCE_CONTRACT:
                raise SourceContractError(
                    f"source returned HTTP {response.status_code}",
                    status_code=response.status_code,
                )
    except Exception as error:
        body_error = error
        raise
    finally:
        try:
            repository.release_capture(request=request)
        except Exception:  # noqa: BLE001 - cleanup은 본문 typed failure를 덮지 않는다.
            if body_error is None:
                release_failed = True
    if release_failed:
        raise CaptureReservationReleaseError(
            "capture reservation could not be released"
        ) from None
    return observation


def _failure_category(status_code: int) -> str | None:
    if status_code in {403, 429}:
        return SOURCE_THROTTLED
    if not 200 <= status_code <= 299:
        return SOURCE_CONTRACT
    return None
