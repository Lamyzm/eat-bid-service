from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import uuid4

import pytest

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_repository import (
    PlannedRequestMismatchError,
    RawBlobIntegrityError,
    TerminalCaptureStateError,
)
from eatbid.object_store import RawObjectStore, StoredRawObject
from eatbid.pipeline.capture import SourceThrottledError, capture
from eatbid.source.client import SourceResponse

from ..unit.fakes import MemoryRawObjectStore, StaticSourceClient
from .conftest import PipelineServices

FETCHED_AT = datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)
BUILD_SHA = "a" * 64


def prepare_request(
    services: PipelineServices, *, params: dict[str, str]
) -> CaptureRequest:
    repository = services.repository
    run_id = uuid4()
    repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=FETCHED_AT,
        expected_count=2,
    )
    planned = repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint="bid-list",
        params=params,
        expected_count=2,
    )
    return CaptureRequest(
        request_unit_id=planned.request_unit_id,
        run_id=planned.run_id,
        source=planned.source,
        endpoint=planned.endpoint,
        params=planned.params,
    )


def test_same_body_is_one_blob_and_two_append_only_observations(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"지역": "서울", "page": "1"})
    body = b"<result><TOT_CNT>2</TOT_CNT></result>"
    client = StaticSourceClient(SourceResponse(200, body, FETCHED_AT))

    first = capture(request, services.store, services.repository, client)
    second = capture(request, services.store, services.repository, client)

    with services.connection.cursor() as cursor:
        digest = sha256(body).hexdigest()
        cursor.execute(
            """
            select content_sha256, object_key, byte_length, content_type,
                   content_encoding, stored_at
            from ingest.raw_blob
            where content_sha256 = %s
            """,
            (digest,),
        )
        blobs = cursor.fetchall()
        cursor.execute(
            """
            select observation_id, run_id, request_unit_id, source, endpoint,
                   request_params, fetched_at, http_status, content_sha256,
                   parser_status
            from ingest.raw_observation
            where run_id = %s
            order by observation_id
            """,
            (request.run_id,),
        )
        observations = cursor.fetchall()
        cursor.execute(
            """
            select request_params, request_params_hash, observed_count, status
            from ingest.request_unit where request_unit_id = %s
            """,
            (request.request_unit_id,),
        )
        request_row = cursor.fetchone()
        cursor.execute(
            "select captured_count, status, failure_category from ingest.run where run_id = %s",
            (request.run_id,),
        )
        run_row = cursor.fetchone()

    assert blobs == [
        (
            digest,
            f"raw/eat/bid-list/{digest}.xml.gz",
            len(body),
            "application/xml",
            "gzip",
            FETCHED_AT,
        )
    ]
    assert [row[0] for row in observations] == [
        first.observation_id,
        second.observation_id,
    ]
    assert all(row[1:5] == (request.run_id, request.request_unit_id, "eat", "bid-list") for row in observations)
    assert all(row[5] == {"page": "1", "지역": "서울"} for row in observations)
    assert all(row[6:] == (FETCHED_AT, 200, digest, "pending") for row in observations)
    assert request_row == (
        {"page": "1", "지역": "서울"},
        sha256('{"page":"1","지역":"서울"}'.encode()).hexdigest(),
        2,
        "captured",
    )
    assert run_row == (2, "running", None)


def test_planning_same_logical_params_is_idempotent(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=FETCHED_AT,
        expected_count=1,
    )

    first = services.repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint="bid-list",
        params={"지역": "서울", "page": "1"},
        expected_count=1,
    )
    second = services.repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint="bid-list",
        params={"page": "1", "지역": "서울"},
        expected_count=1,
    )

    assert second == first
    with pytest.raises(PlannedRequestMismatchError):
        services.repository.plan_request_unit(
            run_id=run_id,
            source="eat",
            endpoint="bid-list",
            params={"page": "1", "지역": "서울"},
            expected_count=2,
        )


def test_invalid_request_identity_is_rejected_before_a_plan_is_written(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=FETCHED_AT,
        expected_count=1,
    )

    with pytest.raises(ValueError, match="endpoint"):
        services.repository.plan_request_unit(
            run_id=run_id,
            source="eat",
            endpoint="Bid_List",
            params={"page": "1"},
            expected_count=1,
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.request_unit where run_id = %s", (run_id,)
        )
        assert cursor.fetchone() == (0,)


def test_failed_request_and_run_are_terminal_for_recapture(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    failed_request = prepare_request(services, params={"page": "failed"})
    another_planned = services.repository.plan_request_unit(
        run_id=failed_request.run_id,
        source="eat",
        endpoint="bid-list",
        params={"page": "other"},
        expected_count=2,
    )
    body = b"<error>blocked</error>"
    client = StaticSourceClient(SourceResponse(429, body, FETCHED_AT))
    with pytest.raises(SourceThrottledError):
        capture(failed_request, services.store, services.repository, client)

    with pytest.raises(TerminalCaptureStateError):
        capture(failed_request, services.store, services.repository, client)
    with pytest.raises(TerminalCaptureStateError):
        capture(
            CaptureRequest(
                request_unit_id=another_planned.request_unit_id,
                run_id=another_planned.run_id,
                source=another_planned.source,
                endpoint=another_planned.endpoint,
                params=another_planned.params,
            ),
            services.store,
            services.repository,
            client,
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (failed_request.run_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select captured_count, status from ingest.run where run_id = %s",
            (failed_request.run_id,),
        )
        assert cursor.fetchone() == (1, "failed")
        cursor.execute(
            """
            select request_params, observed_count, status
            from ingest.request_unit
            where run_id = %s
            order by request_params->>'page'
            """,
            (failed_request.run_id,),
        )
        assert cursor.fetchall() == [
            ({"page": "failed"}, 1, "failed"),
            ({"page": "other"}, 0, "planned"),
        ]


def test_fail_run_is_idempotent_without_overwriting_the_first_failure(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=FETCHED_AT,
        expected_count=0,
    )

    services.repository.fail_run(
        run_id=run_id,
        failure_category="CONFIGURATION",
        failed_at=FETCHED_AT,
    )
    services.repository.fail_run(
        run_id=run_id,
        failure_category="CONFIGURATION",
        failed_at=FETCHED_AT,
    )
    with pytest.raises(TerminalCaptureStateError):
        services.repository.fail_run(
            run_id=run_id,
            failure_category="INTERNAL",
            failed_at=FETCHED_AT + timedelta(seconds=1),
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, failure_category, ended_at from ingest.run where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("failed", "CONFIGURATION", FETCHED_AT)


class ConflictingMetadataStore:
    def __init__(self, delegate: MemoryRawObjectStore) -> None:
        self._delegate = delegate

    def put(self, *, source: str, endpoint: str, body: bytes) -> StoredRawObject:
        stored = self._delegate.put(source=source, endpoint=endpoint, body=body)
        return StoredRawObject(
            content_sha256=stored.content_sha256,
            object_key=stored.object_key,
            byte_length=stored.byte_length,
            stored_at=stored.stored_at + timedelta(seconds=1),
        )

    def read(self, object_key: str) -> bytes:
        return self._delegate.read(object_key)


def test_blob_metadata_conflict_rolls_back_observation_and_counts(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"page": "conflict"})
    body = b"same-content"
    response = SourceResponse(200, body, FETCHED_AT)
    capture(request, services.store, services.repository, StaticSourceClient(response))
    conflicting_store: RawObjectStore = ConflictingMetadataStore(services.store)

    with pytest.raises(RawBlobIntegrityError):
        capture(
            request,
            conflicting_store,
            services.repository,
            StaticSourceClient(response),
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select observed_count from ingest.request_unit where request_unit_id = %s",
            (request.request_unit_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select captured_count from ingest.run where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == (1,)


def test_source_error_body_and_failed_status_commit_atomically(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"page": "throttled"})
    body = b"<error>blocked</error>"

    with pytest.raises(SourceThrottledError):
        capture(
            request,
            services.store,
            services.repository,
            StaticSourceClient(SourceResponse(429, body, FETCHED_AT)),
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select o.http_status, o.content_sha256, r.observed_count, r.status,
                   run.captured_count, run.status, run.failure_category, run.ended_at
            from ingest.raw_observation o
            join ingest.request_unit r on r.request_unit_id = o.request_unit_id
            join ingest.run run on run.run_id = o.run_id
            where o.run_id = %s
            """,
            (request.run_id,),
        )
        row = cursor.fetchone()

    digest = sha256(body).hexdigest()
    assert row == (429, digest, 1, "failed", 1, "failed", "SOURCE_THROTTLED", FETCHED_AT)
    assert services.store.read(f"raw/eat/bid-list/{digest}.xml.gz") == body
