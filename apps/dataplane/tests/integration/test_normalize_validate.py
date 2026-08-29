from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.normalization_repository import (
    NormalizationRepository,
    StoredNormalizedRecord,
)
from eatbid.ingest.postgres_normalization_repository import (
    NormalizationAttemptConflictError,
    NormalizationIntegrityError,
    NormalizationNondeterminismError,
)
from eatbid.ingest.postgres_publication_repository import PublicationIntegrityError
from eatbid.pipeline.capture import capture
from eatbid.pipeline.normalize import DataQuarantinedError, normalize_observation
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import PipelineServices

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
FETCHED_AT = datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)
NORMALIZED_AT = datetime(2026, 8, 29, 4, 6, 0, tzinfo=UTC)
VALIDATED_AT = datetime(2026, 8, 29, 4, 7, 0, tzinfo=UTC)
BUILD_SHA = "b" * 64


def start_run(
    services: PipelineServices,
    *,
    expected_count: int = 1,
    parser_version: str = "eat-v1",
) -> UUID:
    run_id = uuid4()
    services.repository.start_run(
        run_id=run_id,
        mode="poll-open",
        build_sha=BUILD_SHA,
        parser_version=parser_version,
        started_at=FETCHED_AT,
        expected_count=expected_count,
    )
    return run_id


def start_replay_run(
    services: PipelineServices,
    observation_ids: tuple[int, ...],
    *,
    parser_version: str = "eat-v1",
) -> tuple[UUID, UUID]:
    run_id = uuid4()
    publication_id = uuid4()
    state = services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version=parser_version,
        started_at=FETCHED_AT,
    )
    assert state.status == "running"
    return run_id, publication_id


def capture_detail(
    services: PipelineServices,
    *,
    run_id: UUID,
    external_bid_id: str,
    body: bytes | None = None,
    expected_count: int = 1,
    extra_params: dict[str, str] | None = None,
    endpoint: str = "bid-detail",
) -> int:
    params = {"ELCTRN_BID_ID": external_bid_id}
    if extra_params is not None:
        params.update(extra_params)
    planned = services.repository.plan_request_unit(
        run_id=run_id,
        source="eat",
        endpoint=endpoint,
        params=params,
        expected_count=expected_count,
    )
    observed = capture(
        CaptureRequest(
            request_unit_id=planned.request_unit_id,
            run_id=run_id,
            source="eat",
            endpoint=endpoint,
            params=planned.params,
        ),
        services.store,
        services.repository,
        StaticSourceClient(
            SourceResponse(200, FIXTURE.read_bytes() if body is None else body, FETCHED_AT)
        ),
    )
    return observed.observation_id


def capture_run_id(services: PipelineServices, observation_id: int) -> UUID:
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            "select run_id from ingest.raw_observation where observation_id = %s",
            (observation_id,),
        )
        return cursor.fetchone()[0]


def publication_run_id(services: PipelineServices, publication_id: UUID) -> UUID:
    with services.connection.transaction(), services.connection.cursor() as cursor:
        cursor.execute(
            "select run_id from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        return cursor.fetchone()[0]


def normalized_pair(
    services: PipelineServices,
) -> tuple[StoredNormalizedRecord, StoredNormalizedRecord]:
    run_id = start_run(services, expected_count=2)
    observations = (
        capture_detail(services, run_id=run_id, external_bid_id=uuid4().hex),
        capture_detail(services, run_id=run_id, external_bid_id=uuid4().hex),
    )
    return normalize_one(services, observations[0]), normalize_one(
        services, observations[1]
    )


def replace_attempt_record_edges(
    services: PipelineServices,
    records: tuple[StoredNormalizedRecord, StoredNormalizedRecord],
    *,
    topology: str,
) -> None:
    first, second = records
    edges = {
        "swapped": (
            (first.normalization_attempt_id, second.normalized_record_id),
            (second.normalization_attempt_id, first.normalized_record_id),
        ),
        "two-zero": (
            (first.normalization_attempt_id, first.normalized_record_id),
            (first.normalization_attempt_id, second.normalized_record_id),
        ),
    }[topology]
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            delete from ingest.normalization_attempt_record
            where normalization_attempt_id = any(%s)
            """,
            ([first.normalization_attempt_id, second.normalization_attempt_id],),
        )
        cursor.executemany(
            """
            insert into ingest.normalization_attempt_record (
                normalization_attempt_id, normalized_record_id
            ) values (%s, %s)
            """,
            edges,
        )
    services.connection.commit()


def normalize_one(
    services: PipelineServices,
    observation_id: int,
    *,
    processing_run_id: UUID | None = None,
    parser_version: str = "eat-v1",
    normalized_at: datetime = NORMALIZED_AT,
):
    return normalize_observation(
        processing_run_id=(
            capture_run_id(services, observation_id)
            if processing_run_id is None
            else processing_run_id
        ),
        observation_id=observation_id,
        parser_version=parser_version,
        normalized_at=normalized_at,
        store=services.store,
        repository=services.normalization_repository,
    )


@pytest.fixture
def observation_id(pipeline_services: PipelineServices) -> int:
    run_id = start_run(pipeline_services)
    return capture_detail(
        pipeline_services, run_id=run_id, external_bid_id=uuid4().hex
    )


@pytest.fixture
def validated_publication(
    pipeline_services: PipelineServices, observation_id: int
) -> UUID:
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()
    result = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    assert result.status == "validated"
    return publication_id


def test_repeat_normalization_is_one_byte_equivalent_record(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    first = normalize_one(pipeline_services, observation_id)
    second = normalize_one(
        pipeline_services,
        observation_id,
        normalized_at=NORMALIZED_AT + timedelta(minutes=5),
    )

    assert second == first
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*), min(normalized_record_id), max(normalized_record_id)
            from ingest.normalized_record where observation_id = %s
            """,
            (observation_id,),
        )
        count, minimum_id, maximum_id = cursor.fetchone()
        assert (count, minimum_id, maximum_id) == (
            1,
            first.normalized_record_id,
            first.normalized_record_id,
        )
        cursor.execute(
            "select normalized_payload from ingest.normalized_record where normalized_record_id = %s",
            (first.normalized_record_id,),
        )
        persisted = cursor.fetchone()[0]
        cursor.execute(
            """
            select status, schema_fingerprint, quarantine_reason, count(ar.normalized_record_id)
            from ingest.normalization_attempt a
            left join ingest.normalization_attempt_record ar
              on ar.normalization_attempt_id = a.normalization_attempt_id
            where a.run_id = %s and a.observation_id = %s and a.parser_version = 'eat-v1'
            group by a.normalization_attempt_id
            """,
            (first.run_id, observation_id),
        )
        assert cursor.fetchone() == ("normalized", first.schema_fingerprint, None, 1)
    assert json.dumps(
        persisted, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode() == first.canonical_payload


def test_raw_observation_has_only_immutable_http_evidence_columns(
    pipeline_services: PipelineServices,
) -> None:
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select column_name
            from information_schema.columns
            where table_schema = 'ingest' and table_name = 'raw_observation'
            order by ordinal_position
            """
        )
        columns = {str(row[0]) for row in cursor.fetchall()}

    assert columns.isdisjoint(
        {
            "source_entity_id",
            "schema_fingerprint",
            "parser_status",
            "quarantine_reason",
        }
    )


def test_attempt_schema_fingerprint_requires_lowercase_sha256(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    run_id = capture_run_id(pipeline_services, observation_id)

    with (
        pytest.raises(psycopg.errors.CheckViolation),
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            """
            insert into ingest.normalization_attempt (
                run_id, observation_id, parser_version, status, attempted_at,
                schema_fingerprint, quarantine_reason
            ) values (%s, %s, 'invalid-fingerprint', 'normalized', %s, %s, null)
            """,
            (run_id, observation_id, NORMALIZED_AT, "A" * 64),
        )


def test_conflicting_existing_payload_is_reported_as_nondeterminism(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalize_one(pipeline_services, observation_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.normalized_record
            set normalized_payload = '{"external_bid_id":"tampered"}'::jsonb
            where observation_id = %s
            """,
            (observation_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(NormalizationNondeterminismError):
        normalize_one(pipeline_services, observation_id)


@pytest.mark.parametrize(
    "malformed",
    [
        b"<not-closed>",
        b'<!DOCTYPE Root [<!ENTITY x "expanded">]><Root>&x;</Root>',
    ],
)
def test_known_source_parse_failure_quarantines_without_losing_raw(
    pipeline_services: PipelineServices, malformed: bytes
) -> None:
    run_id = start_run(pipeline_services)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        body=malformed,
    )

    with pytest.raises(DataQuarantinedError) as caught:
        normalize_one(pipeline_services, observation_id)

    assert caught.value.exit_code == 65
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select a.status, a.quarantine_reason, b.object_key
            from ingest.raw_observation o
            join ingest.raw_blob b using (content_sha256)
            join ingest.normalization_attempt a
              on a.observation_id = o.observation_id and a.run_id = o.run_id
            where o.observation_id = %s
            """,
            (observation_id,),
        )
        attempt_status, reason, object_key = cursor.fetchone()
        cursor.execute(
            "select count(*) from ingest.normalized_record where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (0,)
    assert attempt_status == "quarantined"
    assert reason and len(reason) <= 500
    assert pipeline_services.store.read(object_key) == malformed


def test_quarantined_attempt_retries_idempotently_without_members(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        body=b"<broken>",
    )

    for offset in range(2):
        with pytest.raises(DataQuarantinedError):
            normalize_one(
                pipeline_services,
                observation_id,
                normalized_at=NORMALIZED_AT + timedelta(minutes=offset),
            )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select count(*), min(status), max(status)
            from ingest.normalization_attempt
            where run_id = %s and observation_id = %s and parser_version = 'eat-v1'
            """,
            (run_id, observation_id),
        )
        assert cursor.fetchone() == (1, "quarantined", "quarantined")
        cursor.execute(
            """
            select count(*)
            from ingest.normalization_attempt_record ar
            join ingest.normalization_attempt a using (normalization_attempt_id)
            where a.run_id = %s and a.observation_id = %s
            """,
            (run_id, observation_id),
        )
        assert cursor.fetchone() == (0,)


def test_final_quarantined_attempt_cannot_regress_to_normalized(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services)
    source_id = uuid4().hex
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=source_id,
        body=b"<broken>",
    )
    with pytest.raises(DataQuarantinedError):
        normalize_one(pipeline_services, observation_id)
    observation = pipeline_services.normalization_repository.load_observation(
        processing_run_id=run_id,
        observation_id=observation_id,
    )

    with pytest.raises(NormalizationAttemptConflictError):
        pipeline_services.normalization_repository.store_normalized(
            observation=observation,
            record_type="auction",
            source_entity_id=source_id,
            parser_version="eat-v1",
            canonical_payload=b'{"external_bid_id":"synthetic"}',
            schema_fingerprint="0" * 64,
            attempted_at=NORMALIZED_AT,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select status, count(ar.normalized_record_id)
            from ingest.normalization_attempt a
            left join ingest.normalization_attempt_record ar
              using (normalization_attempt_id)
            where a.run_id = %s and a.observation_id = %s
            group by a.normalization_attempt_id
            """,
            (run_id, observation_id),
        )
        assert cursor.fetchone() == ("quarantined", 0)
        cursor.execute(
            "select count(*) from ingest.normalized_record where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (0,)


def test_same_raw_has_independent_replay_attempts_without_mutating_evidence(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    capture_result = normalize_one(pipeline_services, observation_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select to_jsonb(o) from ingest.raw_observation o where observation_id = %s",
            (observation_id,),
        )
        raw_before = cursor.fetchone()[0]
    pipeline_services.connection.commit()

    replay_same, _ = start_replay_run(
        pipeline_services, (observation_id,), parser_version="eat-v1"
    )
    same_parser_result = normalize_one(
        pipeline_services,
        observation_id,
        processing_run_id=replay_same,
        parser_version="eat-v1",
    )

    replay_new, _ = start_replay_run(
        pipeline_services, (observation_id,), parser_version="eat-v2"
    )
    new_parser_result = normalize_one(
        pipeline_services,
        observation_id,
        processing_run_id=replay_new,
        parser_version="eat-v2",
    )

    assert same_parser_result.normalized_record_id == capture_result.normalized_record_id
    assert new_parser_result.normalized_record_id != capture_result.normalized_record_id
    assert len(
        {
            capture_result.normalization_attempt_id,
            same_parser_result.normalization_attempt_id,
            new_parser_result.normalization_attempt_id,
        }
    ) == 3
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select to_jsonb(o) from ingest.raw_observation o where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone()[0] == raw_before
        cursor.execute(
            """
            select run_id, parser_version, status
            from ingest.normalization_attempt
            where observation_id = %s order by attempted_at, run_id
            """,
            (observation_id,),
        )
        attempts = cursor.fetchall()
    assert {row[0] for row in attempts} == {
        capture_result.run_id,
        replay_same,
        replay_new,
    }
    assert {(row[1], row[2]) for row in attempts} == {
        ("eat-v1", "normalized"),
        ("eat-v2", "normalized"),
    }


def test_processing_run_membership_and_parser_version_are_authoritative(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    unrelated_capture_run = start_run(pipeline_services)
    with pytest.raises(
        NormalizationIntegrityError, match="must use its own observations"
    ):
        normalize_one(
            pipeline_services,
            observation_id,
            processing_run_id=unrelated_capture_run,
        )

    other_capture_run = start_run(pipeline_services)
    other_observation_id = capture_detail(
        pipeline_services,
        run_id=other_capture_run,
        external_bid_id=uuid4().hex,
    )
    replay_run, _ = start_replay_run(
        pipeline_services, (other_observation_id,), parser_version="eat-v2"
    )
    with pytest.raises(NormalizationIntegrityError, match="replay input manifest"):
        normalize_one(
            pipeline_services,
            observation_id,
            processing_run_id=replay_run,
            parser_version="eat-v2",
        )

    with pytest.raises(RuntimeError, match="parser version differs"):
        normalize_one(
            pipeline_services,
            other_observation_id,
            processing_run_id=replay_run,
            parser_version="eat-v1",
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (0,)


def test_normalization_candidate_requires_a_running_processing_run(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    run_id = capture_run_id(pipeline_services, observation_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.run
            set status = 'failed', failure_category = 'SOURCE_CONTRACT', ended_at = %s
            where run_id = %s
            """,
            (VALIDATED_AT, run_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(NormalizationIntegrityError, match="running"):
        pipeline_services.normalization_repository.load_observation(
            processing_run_id=run_id,
            observation_id=observation_id,
        )


def test_final_normalized_attempt_cannot_regress_to_quarantined(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    observation = pipeline_services.normalization_repository.load_observation(
        processing_run_id=normalized.run_id,
        observation_id=observation_id,
    )

    with pytest.raises(NormalizationAttemptConflictError):
        pipeline_services.normalization_repository.quarantine(
            observation=observation,
            reason="later parser disagreement",
            schema_fingerprint=normalized.schema_fingerprint,
            attempted_at=NORMALIZED_AT,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select status, quarantine_reason, count(ar.normalized_record_id)
            from ingest.normalization_attempt a
            left join ingest.normalization_attempt_record ar
              using (normalization_attempt_id)
            where a.normalization_attempt_id = %s
            group by a.normalization_attempt_id
            """,
            (normalized.normalization_attempt_id,),
        )
        assert cursor.fetchone() == ("normalized", None, 1)


def test_r2_read_failure_is_not_misclassified_as_source_quarantine(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    class FailingReadStore:
        def put(self, *, source: str, endpoint: str, body: bytes):  # pragma: no cover
            raise AssertionError("not used")

        def read(self, object_key: str) -> bytes:
            raise RuntimeError("object store unavailable")

    with pytest.raises(RuntimeError, match="object store unavailable"):
        normalize_observation(
            processing_run_id=capture_run_id(pipeline_services, observation_id),
            observation_id=observation_id,
            parser_version="eat-v1",
            normalized_at=NORMALIZED_AT,
            store=FailingReadStore(),
            repository=pipeline_services.normalization_repository,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (0,)


def test_database_write_failure_is_not_misclassified_as_source_quarantine(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    class FailingWriteRepository:
        quarantine_called = False

        def load_observation(self, *, processing_run_id: UUID, observation_id: int):
            return pipeline_services.normalization_repository.load_observation(
                processing_run_id=processing_run_id,
                observation_id=observation_id,
            )

        def store_normalized(self, **_kwargs):
            raise psycopg.OperationalError("database write unavailable")

        def quarantine(self, **_kwargs) -> None:
            self.quarantine_called = True

    repository = FailingWriteRepository()
    with pytest.raises(psycopg.OperationalError, match="database write unavailable"):
        normalize_observation(
            processing_run_id=capture_run_id(pipeline_services, observation_id),
            observation_id=observation_id,
            parser_version="eat-v1",
            normalized_at=NORMALIZED_AT,
            store=pipeline_services.store,
            repository=cast(NormalizationRepository, repository),
        )

    assert repository.quarantine_called is False
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (0,)


def assert_failed_without_core_writes(
    services: PipelineServices,
    run_id: UUID,
    publication_id: UUID,
) -> None:
    with services.connection.cursor() as cursor:
        cursor.execute(
            "select status, failure_category, ended_at from ingest.run where run_id = %s",
            (run_id,),
        )
        status, category, ended_at = cursor.fetchone()
        assert (status, category, ended_at) == ("failed", "SOURCE_CONTRACT", VALIDATED_AT)
        cursor.execute(
            """
            select status, validated_at, activated_at, published_count,
                   canonical_fingerprint, projector_version
            from ingest.publication where publication_id = %s
            """,
            (publication_id,),
        )
        assert cursor.fetchone() == ("failed", None, None, 0, None, None)
        cursor.execute(
            "select count(*) from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            """
            select count(*)
            from core.auction_revision revision
            join ingest.normalization_attempt_record edge using (normalized_record_id)
            join ingest.normalization_attempt attempt using (normalization_attempt_id)
            where attempt.run_id = %s
            """,
            (run_id,),
        )
        assert cursor.fetchone() == (0,)


def test_request_count_mismatch_fails_monotonically_and_preserves_existing_core_rows(
    pipeline_services: PipelineServices,
) -> None:
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into core.auction_attempt (source_system, external_bid_id) "
            "values ('fixture', 'preserved')"
        )

    run_id = start_run(pipeline_services, expected_count=2)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        expected_count=2,
    )
    normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()

    first = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    second = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT + timedelta(hours=1),
        repository=pipeline_services.publication_repository,
    )

    assert first == second
    assert first.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from core.auction_attempt "
            "where source_system = 'fixture' and external_bid_id = 'preserved'"
        )
        assert cursor.fetchone() == (1,)


def test_failed_request_status_blocks_even_when_counts_match(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "update ingest.request_unit set status = 'failed' where run_id = %s",
            (normalized.run_id,),
        )
    pipeline_services.connection.commit()
    publication_id = uuid4()

    result = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(
        pipeline_services, normalized.run_id, publication_id
    )


def test_run_expected_count_must_match_locked_observation_count(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services, expected_count=2)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        expected_count=1,
    )
    normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


def test_missing_normalization_attempt_blocks_publication(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select run_id from ingest.raw_observation where observation_id = %s",
            (observation_id,),
        )
        run_id = cursor.fetchone()[0]
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


def test_parser_version_mismatch_blocks_publication(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.normalization_attempt set parser_version = 'eat-v2'
            where normalization_attempt_id = %s
            """,
            (normalized.normalization_attempt_id,),
        )
    pipeline_services.connection.commit()
    publication_id = uuid4()

    result = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(
        pipeline_services, normalized.run_id, publication_id
    )


def test_quarantine_blocks_publication(pipeline_services: PipelineServices) -> None:
    run_id = start_run(pipeline_services)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        body=b"<broken>",
    )
    with pytest.raises(DataQuarantinedError):
        normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


def test_duplicate_source_entity_blocks_publication(
    pipeline_services: PipelineServices,
) -> None:
    run_id = start_run(pipeline_services, expected_count=2)
    source_id = uuid4().hex
    first = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=source_id,
        extra_params={"variant": "first"},
    )
    second = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=source_id,
        extra_params={"variant": "second"},
    )
    normalize_one(pipeline_services, first)
    normalize_one(pipeline_services, second)
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


def test_missing_required_scheme_blocks_publication(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()

    with pipeline_services.connection.transaction(force_rollback=True):
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                "update core.code_scheme set namespace = 'disabled:organization' "
                "where namespace = 'eat:organization'"
            )
        result = validate_run(
            run_id=normalized.run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert result.status == "failed"
        assert_failed_without_core_writes(
            pipeline_services, normalized.run_id, publication_id
        )


def test_unreviewed_source_column_preserves_attempt_but_blocks_publication(
    pipeline_services: PipelineServices,
) -> None:
    body = FIXTURE.read_bytes().replace(
        b"</ColumnInfo>",
        b'<Column id="UNREVIEWED_FIELD" type="STRING"/></ColumnInfo>',
        1,
    ).replace(
        b"</Row>",
        b'<Col id="UNREVIEWED_FIELD">observed</Col></Row>',
        1,
    )
    run_id = start_run(pipeline_services)
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        body=body,
    )
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select a.status, a.schema_fingerprint, count(o.observation_id)
            from ingest.normalization_attempt a
            join ingest.raw_observation o using (observation_id)
            where a.normalization_attempt_id = %s
            group by a.normalization_attempt_id
            """,
            (normalized.normalization_attempt_id,),
        )
        assert cursor.fetchone() == ("normalized", normalized.schema_fingerprint, 1)


@pytest.mark.parametrize(
    ("endpoint", "parser_version"),
    [
        ("unreviewed-detail", "eat-v1"),
        ("bid-detail", "eat-v2"),
    ],
)
def test_unknown_source_contract_identity_blocks_publication(
    pipeline_services: PipelineServices,
    endpoint: str,
    parser_version: str,
) -> None:
    run_id = start_run(pipeline_services, parser_version=parser_version)
    body = FIXTURE.read_bytes().replace(
        b"E250617-472599-1",
        f"SYNTHETIC-{endpoint}-{parser_version}".encode(),
    )
    observation_id = capture_detail(
        pipeline_services,
        run_id=run_id,
        external_bid_id=uuid4().hex,
        endpoint=endpoint,
        body=body,
    )
    normalized = normalize_one(
        pipeline_services,
        observation_id,
        parser_version=parser_version,
    )
    publication_id = uuid4()

    result = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    assert result.status == "failed"
    assert_failed_without_core_writes(pipeline_services, run_id, publication_id)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            select status, schema_fingerprint
            from ingest.normalization_attempt
            where normalization_attempt_id = %s
            """,
            (normalized.normalization_attempt_id,),
        )
        assert cursor.fetchone() == ("normalized", normalized.schema_fingerprint)


def test_complete_run_freezes_exact_members_and_revalidation_is_idempotent(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()
    first = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.normalized_record (
                observation_id, record_type, source_entity_id, normalized_payload,
                parser_version, normalized_at
            ) values (%s, 'staged-extra', %s, '{}'::jsonb, 'eat-v1', %s)
            returning normalized_record_id
            """,
            (observation_id, normalized.source_entity_id, NORMALIZED_AT),
        )
        extra_id = cursor.fetchone()[0]
    pipeline_services.connection.commit()

    second = validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT + timedelta(hours=1),
        repository=pipeline_services.publication_repository,
    )

    assert second == first
    assert first.status == "validated"
    assert first.member_ids == (normalized.normalized_record_id,)
    assert extra_id not in first.member_ids
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select normalized_record_id from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchall() == [(normalized.normalized_record_id,)]
        cursor.execute(
            "select status, activated_at, published_count from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("validated", None, 0)
        cursor.execute(
            "select status, published_count from ingest.run where run_id = %s",
            (normalized.run_id,),
        )
        assert cursor.fetchone() == ("validated", 0)
        cursor.execute(
            """
            select count(*) from core.auction_revision revision
            join ingest.normalization_attempt_record edge using (normalized_record_id)
            join ingest.normalization_attempt attempt using (normalization_attempt_id)
            where attempt.run_id = %s
            """,
            (normalized.run_id,),
        )
        assert cursor.fetchone() == (0,)


def test_terminal_revalidation_rejects_same_cardinality_member_substitution(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()
    validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.normalized_record (
                observation_id, record_type, source_entity_id, normalized_payload,
                parser_version, normalized_at
            ) values (%s, 'unrelated', %s, '{}'::jsonb, 'eat-v1', %s)
            returning normalized_record_id
            """,
            (observation_id, normalized.source_entity_id, NORMALIZED_AT),
        )
        unrelated_id = cursor.fetchone()[0]
        cursor.execute(
            "delete from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        cursor.execute(
            """
            insert into ingest.publication_record (publication_id, normalized_record_id)
            values (%s, %s)
            """,
            (publication_id, unrelated_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="member"):
        validate_run(
            run_id=normalized.run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_publication_status_drift(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    publication_id = uuid4()
    validate_run(
        run_id=normalized.run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.publication
            set status = 'pending', validated_at = null
            where publication_id = %s
            """,
            (publication_id,),
        )
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="status"):
        validate_run(
            run_id=normalized.run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_quarantined_current_attempt(
    pipeline_services: PipelineServices, validated_publication: UUID
) -> None:
    run_id = publication_run_id(pipeline_services, validated_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.normalization_attempt
            set status = 'quarantined', quarantine_reason = 'synthetic terminal drift'
            where run_id = %s and parser_version = 'eat-v1'
            """,
            (run_id,),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="ledger"):
        validate_run(
            run_id=run_id,
            publication_id=validated_publication,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_extra_parser_attempt(
    pipeline_services: PipelineServices, validated_publication: UUID
) -> None:
    run_id = publication_run_id(pipeline_services, validated_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.normalization_attempt (
                run_id, observation_id, parser_version, status, attempted_at,
                schema_fingerprint, quarantine_reason
            )
            select run_id, observation_id, 'eat-v2', 'quarantined', %s, null,
                   'synthetic parser mismatch'
            from ingest.normalization_attempt
            where run_id = %s and parser_version = 'eat-v1'
            """,
            (NORMALIZED_AT + timedelta(minutes=1), run_id),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="ledger"):
        validate_run(
            run_id=run_id,
            publication_id=validated_publication,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_failed_request(
    pipeline_services: PipelineServices, validated_publication: UUID
) -> None:
    run_id = publication_run_id(pipeline_services, validated_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "update ingest.request_unit set status = 'failed' where run_id = %s",
            (run_id,),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="ledger"):
        validate_run(
            run_id=run_id,
            publication_id=validated_publication,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_candidate_count_drift(
    pipeline_services: PipelineServices, validated_publication: UUID
) -> None:
    run_id = publication_run_id(pipeline_services, validated_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.raw_observation (
                run_id, request_unit_id, source, endpoint, request_params,
                fetched_at, http_status, content_sha256
            )
            select run_id, request_unit_id, source, endpoint, request_params,
                   fetched_at + interval '1 second', http_status, content_sha256
            from ingest.raw_observation
            where run_id = %s
            """,
            (run_id,),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="ledger"):
        validate_run(
            run_id=run_id,
            publication_id=validated_publication,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


def test_terminal_revalidation_rejects_request_count_drift(
    pipeline_services: PipelineServices, validated_publication: UUID
) -> None:
    run_id = publication_run_id(pipeline_services, validated_publication)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            update ingest.request_unit
            set expected_count = 2, observed_count = 2
            where run_id = %s
            """,
            (run_id,),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(PublicationIntegrityError, match="ledger"):
        validate_run(
            run_id=run_id,
            publication_id=validated_publication,
            validated_at=VALIDATED_AT + timedelta(hours=1),
            repository=pipeline_services.publication_repository,
        )


@pytest.mark.parametrize("terminal", [False, True], ids=["running", "terminal"])
def test_publication_rejects_swapped_candidate_member_edges(
    pipeline_services: PipelineServices, terminal: bool
) -> None:
    records = normalized_pair(pipeline_services)
    run_id = records[0].run_id
    publication_id = uuid4()
    if terminal:
        initial = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert initial.status == "validated"
    replace_attempt_record_edges(pipeline_services, records, topology="swapped")

    if terminal:
        with pytest.raises(PublicationIntegrityError, match="ledger"):
            validate_run(
                run_id=run_id,
                publication_id=publication_id,
                validated_at=VALIDATED_AT + timedelta(hours=1),
                repository=pipeline_services.publication_repository,
            )
    else:
        result = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert result.status == "failed"
        assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


@pytest.mark.parametrize("terminal", [False, True], ids=["running", "terminal"])
def test_publication_rejects_two_zero_output_redistribution(
    pipeline_services: PipelineServices, terminal: bool
) -> None:
    records = normalized_pair(pipeline_services)
    run_id = records[0].run_id
    publication_id = uuid4()
    if terminal:
        initial = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert initial.status == "validated"
    replace_attempt_record_edges(pipeline_services, records, topology="two-zero")

    if terminal:
        with pytest.raises(PublicationIntegrityError, match="ledger"):
            validate_run(
                run_id=run_id,
                publication_id=publication_id,
                validated_at=VALIDATED_AT + timedelta(hours=1),
                repository=pipeline_services.publication_repository,
            )
    else:
        result = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert result.status == "failed"
        assert_failed_without_core_writes(pipeline_services, run_id, publication_id)


def test_replay_mode_uses_explicit_input_without_mutating_capture_provenance(
    pipeline_services: PipelineServices, observation_id: int
) -> None:
    normalized = normalize_one(pipeline_services, observation_id)
    replay_runs_and_publications = [
        start_replay_run(pipeline_services, (observation_id,)) for _ in range(2)
    ]
    replay_runs = [item[0] for item in replay_runs_and_publications]
    results = []
    for replay_run_id, publication_id in replay_runs_and_publications:
        replay_normalized = normalize_one(
            pipeline_services,
            observation_id,
            processing_run_id=replay_run_id,
            parser_version="eat-v1",
        )
        assert replay_normalized.normalized_record_id == normalized.normalized_record_id
        results.append(
            validate_run(
                run_id=replay_run_id,
                publication_id=publication_id,
                validated_at=VALIDATED_AT,
                repository=pipeline_services.publication_repository,
            )
        )

    assert [result.status for result in results] == ["validated", "validated"]
    assert [result.member_ids for result in results] == [
        (normalized.normalized_record_id,),
        (normalized.normalized_record_id,),
    ]
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select run_id from ingest.raw_observation where observation_id = %s",
            (observation_id,),
        )
        assert cursor.fetchone() == (normalized.run_id,)
        cursor.execute(
            "select observation_id from ingest.replay_input where run_id = %s",
            (replay_runs[0],),
        )
        assert cursor.fetchall() == [(observation_id,)]
        cursor.execute(
            "select observation_id from ingest.replay_input where run_id = %s",
            (replay_runs[1],),
        )
        assert cursor.fetchall() == [(observation_id,)]
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s",
            (replay_runs[0],),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            """
            select normalized_record_id, count(*)
            from ingest.publication_record
            where publication_id = any(%s)
            group by normalized_record_id
            """,
            ([result.publication_id for result in results],),
        )
        assert cursor.fetchall() == [(normalized.normalized_record_id, 2)]


def test_lineage_manifest_foreign_keys_reject_unknown_members(
    pipeline_services: PipelineServices,
) -> None:
    with (
        pytest.raises(psycopg.errors.ForeignKeyViolation),
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(
            "insert into ingest.replay_input (run_id, observation_id) values (%s, %s)",
            (uuid4(), 9_223_372_036_854_775_000),
        )


@pytest.mark.parametrize(
    "statement",
    [
        "insert into ingest.normalization_attempt_record values (null, null)",
        "insert into ingest.publication_record values (null, null)",
        "insert into ingest.replay_input values (null, null)",
    ],
)
def test_lineage_manifest_primary_keys_enforce_non_null_members(
    pipeline_services: PipelineServices, statement: str
) -> None:
    with (
        pytest.raises(psycopg.errors.NotNullViolation),
        pipeline_services.connection.transaction(),
        pipeline_services.connection.cursor() as cursor,
    ):
        cursor.execute(statement)
