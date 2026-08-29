from __future__ import annotations

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest
from eatbid.ingest.repository import IngestRepository
from eatbid.object_store import RawObjectStore
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
    if not isinstance(response, SourceResponse):
        raise TypeError("source client must return SourceResponse")
    stored = store.put(
        source=request.source,
        endpoint=request.endpoint,
        body=response.body,
    )
    failure_category = _failure_category(response.status_code)
    observation = repository.record_observation(
        request=request,
        response=response,
        stored=stored,
        failure_category=failure_category,
    )
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
