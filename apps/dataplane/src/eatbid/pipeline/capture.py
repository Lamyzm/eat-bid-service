"""모듈 책임: source 응답을 raw object와 observation 순서로 보존한 뒤 실패를 분류한다."""

from __future__ import annotations

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest
from eatbid.ingest.repository import IngestRepository
from eatbid.object_store import RawObjectStore, raw_content_sha256
from eatbid.source.client import SourceClient, SourceResponse

SOURCE_THROTTLED = "SOURCE_THROTTLED"
SOURCE_CONTRACT = "SOURCE_CONTRACT"


class SourceCaptureError(RuntimeError):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"source returned HTTP {status_code}")
        self.status_code = status_code


class SourceThrottledError(SourceCaptureError):
    """The source rejected or throttled the request."""


def capture(
    request: CaptureRequest,
    store: RawObjectStore,
    repository: IngestRepository,
    client: SourceClient,
) -> CapturedObservation:
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
    if existing is not None:
        return existing
    try:
        stored = store.put(
            source=request.source, endpoint=request.endpoint, body=response.body,
        )
        failure_category = _failure_category(response.status_code)
        observation = repository.record_observation(
            request=request, response=response, stored=stored,
            failure_category=failure_category,
        )
    finally:
        repository.release_capture(request=request)
    if failure_category == SOURCE_THROTTLED:
        raise SourceThrottledError(response.status_code)
    if failure_category == SOURCE_CONTRACT:
        raise SourceContractError(
            f"source returned HTTP {response.status_code}",
            status_code=response.status_code,
        )
    return observation


def _failure_category(status_code: int) -> str | None:
    if status_code in {403, 429}:
        return SOURCE_THROTTLED
    if not 200 <= status_code <= 299:
        return SOURCE_CONTRACT
    return None
