from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from eatbid.cli import exit_code_for_error
from eatbid.ingest.models import CapturedObservation, CaptureRequest
from eatbid.ingest.repository import canonical_request_params, request_params_sha256
from eatbid.object_store import StoredRawObject
from eatbid.pipeline.capture import (
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    SourceContractError,
    SourceThrottledError,
    capture,
)
from eatbid.source.client import SourceResponse

from .fakes import (
    FailingRawObjectStore,
    MemoryRawObjectStore,
    RecordingStore,
    StaticSourceClient,
)

RUN_ID = UUID("00000000-0000-0000-0000-000000000001")
FETCHED_AT = datetime(2026, 8, 29, 1, 2, 3, tzinfo=UTC)


class RecordingRepository:
    def __init__(self, events: list[str] | None = None) -> None:
        self.events = events if events is not None else []
        self.records: list[
            tuple[CaptureRequest, SourceResponse, StoredRawObject, str | None]
        ] = []

    def start_run(self, **kwargs: object) -> None:
        raise AssertionError("capture must not start a run")

    def plan_request_unit(self, **kwargs: object) -> object:
        raise AssertionError("capture must not plan a request")

    def record_observation(
        self,
        *,
        request: CaptureRequest,
        response: SourceResponse,
        stored: StoredRawObject,
        failure_category: str | None,
    ) -> CapturedObservation:
        self.events.append("observation_recorded")
        self.records.append((request, response, stored, failure_category))
        return CapturedObservation(
            observation_id=len(self.records),
            content_sha256=stored.content_sha256,
            object_key=stored.object_key,
            fetched_at=response.fetched_at,
        )

    def fail_run(self, **kwargs: object) -> None:
        raise AssertionError("capture failure must be recorded atomically")


def capture_request(params: Mapping[str, str] | None = None) -> CaptureRequest:
    return CaptureRequest(
        request_unit_id=1,
        run_id=RUN_ID,
        source="eat",
        endpoint="bid-list",
        params={} if params is None else params,
    )


def test_capture가_전에_recording_observation을_보관한다() -> None:
    events: list[str] = []
    store = RecordingStore(events)
    repository = RecordingRepository(events)
    client = StaticSourceClient(
        SourceResponse(200, b"<result><TOT_CNT>1</TOT_CNT></result>", FETCHED_AT)
    )

    result = capture(capture_request(), store, repository, client)

    assert events == ["object_stored", "observation_recorded"]
    assert result.observation_id == 1


def test_archive_failure가_zero_repository_calls을_생성한다() -> None:
    repository = RecordingRepository()
    client = StaticSourceClient(SourceResponse(200, b"response", FETCHED_AT))

    with pytest.raises(RuntimeError, match="archive unavailable"):
        capture(
            capture_request(),
            FailingRawObjectStore(),
            repository,
            client,
        )

    assert repository.records == []


@pytest.mark.parametrize("status_code", [403, 429])
def test_throttled_response_body는_archived_및_recorded_전에_error이다(
    status_code: int,
) -> None:
    body = b"<error>rate limited</error>"
    store = MemoryRawObjectStore()
    repository = RecordingRepository()

    with pytest.raises(SourceThrottledError):
        capture(
            capture_request(),
            store,
            repository,
            StaticSourceClient(SourceResponse(status_code, body, FETCHED_AT)),
        )

    _, _, stored, failure_category = repository.records[0]
    assert store.read(stored.object_key) == body
    assert failure_category == SOURCE_THROTTLED
    assert exit_code_for_error(SourceThrottledError(status_code)) == 75


def test_나머지_non_success_response는_archived_로_source_contract_failure이다() -> None:
    from eatbid.errors import SourceContractError as CommonSourceContractError

    store = MemoryRawObjectStore()
    repository = RecordingRepository()

    with pytest.raises(CommonSourceContractError) as caught:
        capture(
            capture_request(),
            store,
            repository,
            StaticSourceClient(SourceResponse(500, b"upstream failed", FETCHED_AT)),
        )

    assert repository.records[0][3] == SOURCE_CONTRACT
    assert isinstance(caught.value, SourceContractError)
    assert caught.value.status_code == 500
    assert exit_code_for_error(caught.value) == 76


def test_동일한_body가_하나_object_및_둘_observations을_생성한다() -> None:
    store = MemoryRawObjectStore()
    repository = RecordingRepository()
    client = StaticSourceClient(SourceResponse(200, b"same", FETCHED_AT))
    request = capture_request({"page": "1"})

    first = capture(request, store, repository, client)
    second = capture(request, store, repository, client)

    assert store.object_count == 1
    assert len(repository.records) == 2
    assert first.observation_id != second.observation_id
    assert first.content_sha256 == second.content_sha256


unicode_text = st.text(
    alphabet=st.characters(blacklist_categories=("Cs",)), max_size=20
)


@settings(max_examples=60, derandomize=True)
@given(st.dictionaries(unicode_text, unicode_text, max_size=8))
def test_canonical_parameter가_mapping_insert_순서를_무시한다(
    params: dict[str, str],
) -> None:
    reversed_params = dict(reversed(list(params.items())))

    assert canonical_request_params(params) == canonical_request_params(reversed_params)
    assert request_params_sha256(params) == request_params_sha256(reversed_params)


@settings(max_examples=60, derandomize=True)
@given(unicode_text, unicode_text)
def test_canonical_params_hash가_일_때_value_changes을_바꾼다(
    first: str, second: str
) -> None:
    if first == second:
        return

    assert request_params_sha256({"key": first}) != request_params_sha256(
        {"key": second}
    )


def test_canonical_params가_정확한_utf8_compact_json을_사용한다() -> None:
    assert canonical_request_params({"한글": "", "a": "é"}) == (
        '{"a":"é","한글":""}'.encode()
    )


@pytest.mark.parametrize(
    "params",
    [
        {"page": 1},
        {1: "page"},
        {"enabled": True},
        {"nested": {"page": "1"}},
    ],
)
def test_canonical_params가_unsupported_types을_거부한다(params: Mapping[Any, Any]) -> None:
    with pytest.raises(TypeError, match="request params must map strings to strings"):
        canonical_request_params(params)


@pytest.mark.parametrize(
    ("status_code", "body", "fetched_at"),
    [
        (99, b"x", FETCHED_AT),
        (600, b"x", FETCHED_AT),
        (True, b"x", FETCHED_AT),
        (200, bytearray(b"x"), FETCHED_AT),
        (200, b"x", FETCHED_AT.replace(tzinfo=None)),
        (200, b"x", "2026-08-29T01:02:03Z"),
    ],
)
def test_source_response가_유효하지_않은_boundaries을_거부한다(
    status_code: Any, body: Any, fetched_at: Any
) -> None:
    with pytest.raises((TypeError, ValueError)):
        SourceResponse(status_code, body, fetched_at)
