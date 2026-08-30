from __future__ import annotations

from datetime import UTC, datetime, timedelta
from hashlib import sha256
from uuid import UUID, uuid4

import pytest

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_repository import (
    PlannedRequestMismatchError,
    RawBlobIntegrityError,
    TerminalCaptureStateError,
)
from eatbid.object_store import RawObjectStore, StoredRawObject
from eatbid.pipeline.capture import SourceThrottledError, capture
from eatbid.r2_store import R2RawObjectStore, R2Settings
from eatbid.source.client import SourceResponse

from ..unit.fakes import (
    MemoryRawObjectStore,
    StatefulFakeS3Client,
    StaticSourceClient,
)
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


def set_run_nonrunning(
    services: PipelineServices, *, run_id: UUID, status: str
) -> None:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.run
            set status = %s,
                failure_category = case when %s = 'failed' then 'SOURCE_CONTRACT' end,
                ended_at = case when %s in ('failed', 'published') then %s end,
                published_count = case when %s = 'published' then expected_count else 0 end
            where run_id = %s
            """,
            (status, status, status, FETCHED_AT, status, run_id),
        )
    services.connection.commit()


def test_동일한_body_is_one_blob_and_two_append_only_observations(
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
                   request_params, fetched_at, http_status, content_sha256
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
    assert all(row[6:] == (FETCHED_AT, 200, digest) for row in observations)
    assert request_row == (
        {"page": "1", "지역": "서울"},
        sha256('{"page":"1","지역":"서울"}'.encode()).hexdigest(),
        2,
        "captured",
    )
    assert run_row == (2, "running", None)


def test_R2_provider_timestamp_is_stable_across_duplicate_observations_동작을_검증한다(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"page": "r2-timestamp"})
    body = b"provider-authoritative-timestamp"
    client = StaticSourceClient(SourceResponse(200, body, FETCHED_AT))
    s3 = StatefulFakeS3Client()
    store = R2RawObjectStore(
        R2Settings(
            R2_ENDPOINT_URL="https://account.r2.cloudflarestorage.com",
            R2_BUCKET="eatbid-raw",
            R2_ACCESS_KEY_ID="test-access-id",
            R2_SECRET_ACCESS_KEY="test-secret-key",
        ),
        client=s3,
    )

    first = capture(request, store, services.repository, client)
    second = capture(request, store, services.repository, client)

    provider_timestamp = s3.objects[first.object_key].last_modified
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            select stored_at from ingest.raw_blob where content_sha256 = %s
            """,
            (first.content_sha256,),
        )
        raw_blob = cursor.fetchone()
        cursor.execute(
            """
            select count(*) from ingest.raw_observation where run_id = %s
            """,
            (request.run_id,),
        )
        observation_count = cursor.fetchone()

    assert first.content_sha256 == second.content_sha256
    assert raw_blob == (provider_timestamp,)
    assert observation_count == (2,)
    assert len(s3.objects) == 1
    assert len(s3.head_requests) == 3


def test_계획_same_logical_params_is_idempotent(
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


def test_유효하지_않은_request_identity_is_rejected_before_a_plan_is_written(
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


@pytest.mark.parametrize("inactive_status", ["planned", "failed", "validated", "published"])
def test_계획_rejects_non_running_run_without_changing_existing_plans(
    pipeline_services: PipelineServices,
    inactive_status: str,
) -> None:
    services = pipeline_services
    existing = prepare_request(services, params={"page": f"existing-{inactive_status}"})
    set_run_nonrunning(
        services, run_id=existing.run_id, status=inactive_status
    )

    for params in (
        dict(existing.params),
        {"page": f"new-{inactive_status}"},
    ):
        with pytest.raises(TerminalCaptureStateError):
            services.repository.plan_request_unit(
                run_id=existing.run_id,
                source="eat",
                endpoint="bid-list",
                params=params,
                expected_count=2,
            )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, captured_count from ingest.run where run_id = %s",
            (existing.run_id,),
        )
        assert cursor.fetchone() == (inactive_status, 0)
        cursor.execute(
            """
            select request_unit_id, request_params, observed_count, status
            from ingest.request_unit where run_id = %s
            """,
            (existing.run_id,),
        )
        assert cursor.fetchall() == [
            (existing.request_unit_id, dict(existing.params), 0, "planned")
        ]


@pytest.mark.parametrize("terminal_status", ["planned", "failed", "validated", "published"])
def test_기록_rejects_non_running_run_without_changing_ledger_rows(
    pipeline_services: PipelineServices,
    terminal_status: str,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"page": f"record-{terminal_status}"})
    set_run_nonrunning(
        services, run_id=request.run_id, status=terminal_status
    )
    body = f"terminal-{terminal_status}".encode()

    with pytest.raises(TerminalCaptureStateError):
        capture(
            request,
            services.store,
            services.repository,
            StaticSourceClient(SourceResponse(200, body, FETCHED_AT)),
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, captured_count from ingest.run where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == (terminal_status, 0)
        cursor.execute(
            """
            select observed_count, status from ingest.request_unit
            where request_unit_id = %s
            """,
            (request.request_unit_id,),
        )
        assert cursor.fetchone() == (0, "planned")
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select count(*) from ingest.raw_blob where content_sha256 = %s",
            (sha256(body).hexdigest(),),
        )
        assert cursor.fetchone() == (0,)


def test_기록_rejects_failed_request_while_run_remains_active(
    pipeline_services: PipelineServices,
) -> None:
    services = pipeline_services
    request = prepare_request(services, params={"page": "failed-request"})
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.request_unit set status = 'failed'
            where request_unit_id = %s
            """,
            (request.request_unit_id,),
        )
    services.connection.commit()

    with pytest.raises(TerminalCaptureStateError):
        capture(
            request,
            services.store,
            services.repository,
            StaticSourceClient(SourceResponse(200, b"failed-request", FETCHED_AT)),
        )

    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, captured_count from ingest.run where run_id = %s",
            (request.run_id,),
        )
        assert cursor.fetchone() == ("running", 0)
        cursor.execute(
            """
            select observed_count, status from ingest.request_unit
            where request_unit_id = %s
            """,
            (request.request_unit_id,),
        )
        assert cursor.fetchone() == (0, "failed")


def test_실패한_request_and_run_are_terminal_for_recapture(
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


def test_실패_run_is_idempotent_without_overwriting_the_first_failure(
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


def test_blob_metadata_conflict_rolls_back_observation_and_counts_동작을_검증한다(
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


def test_원본_error_body_and_failed_status_commit_atomically(
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
