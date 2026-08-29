from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from dataclasses import replace
from datetime import timedelta
from pathlib import Path
from threading import Barrier
from uuid import UUID, uuid4

import psycopg
import pytest
from psycopg.types.json import Jsonb

from eatbid.core.repository import ProjectionContractError
from eatbid.errors import SourceContractError
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_replay_repository import (
    ReplayIntegrityError,
    ReplayTransactionScopeError,
)
from eatbid.ingest.postgres_repository import IngestIntegrityError
from eatbid.ingest.replay_repository import ReplayRunState
from eatbid.ingest.repository import request_params_sha256
from eatbid.pipeline.normalize import DataQuarantinedError, normalize_observation
from eatbid.pipeline.project import build_eat_auction_projection
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceResponse

from .conftest import MigratedDatabase, PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    FETCHED_AT,
    NORMALIZED_AT,
    VALIDATED_AT,
    capture_detail,
    normalize_one,
    replace_attempt_record_edges,
    start_run,
)

ACTIVATED_AT = VALIDATED_AT + timedelta(minutes=1)
REPLAY_STARTED_AT = FETCHED_AT + timedelta(seconds=1)
FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"


def _services(
    services: PipelineServices, *, store: object | None = None
) -> ReplayServices:
    return ReplayServices(
        replay_repository=services.replay_repository,
        normalization_repository=services.normalization_repository,
        publication_repository=services.publication_repository,
        projection_repository=services.projection_repository,
        store=services.store if store is None else store,  # type: ignore[arg-type]
    )


def _capture(
    services: PipelineServices,
    *,
    count: int = 1,
    body: bytes | None = None,
) -> tuple[int, ...]:
    run_id = start_run(services, expected_count=count)
    return tuple(
        capture_detail(
            services,
            run_id=run_id,
            external_bid_id=f"replay-{uuid4().hex}",
            body=body,
        )
        for _ in range(count)
    )


def _unreviewed_body() -> bytes:
    return (
        FIXTURE.read_bytes()
        .replace(
            b"</ColumnInfo>",
            b'<Column id="UNREVIEWED_FIELD" type="STRING"/></ColumnInfo>',
            1,
        )
        .replace(b"</Row>", b'<Col id="UNREVIEWED_FIELD">new</Col></Row>', 1)
    )


def _insert_quarantined_attempt(
    services: PipelineServices,
    *,
    run_id: UUID,
    observation_id: int,
    parser_version: str,
) -> int:
    with services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.normalization_attempt (
                run_id, observation_id, parser_version, status, attempted_at,
                schema_fingerprint, quarantine_reason
            ) values (%s, %s, %s, 'quarantined', %s, null, 'tamper')
            returning normalization_attempt_id
            """,
            (run_id, observation_id, parser_version, VALIDATED_AT),
        )
        attempt_id = int(cursor.fetchone()[0])
    services.connection.commit()
    return attempt_id


def _capture_pair(
    services: PipelineServices, *, first_body: bytes | None = None
) -> tuple[int, int]:
    capture_run_id = start_run(services, expected_count=2)
    return (
        capture_detail(
            services,
            run_id=capture_run_id,
            external_bid_id=f"replay-{uuid4().hex}",
            body=first_body,
        ),
        capture_detail(
            services,
            run_id=capture_run_id,
            external_bid_id=f"replay-{uuid4().hex}",
        ),
    )


def _load_replay_state(
    services: PipelineServices,
    observation_ids: tuple[int, ...],
    *,
    run_id: UUID,
    publication_id: UUID,
) -> ReplayRunState:
    return services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )


def _normalize_replay_member(
    services: PipelineServices, *, run_id: UUID, observation_id: int
):
    return normalize_observation(
        processing_run_id=run_id,
        observation_id=observation_id,
        parser_version="eat-v1",
        normalized_at=NORMALIZED_AT,
        store=services.store,
        repository=services.normalization_repository,
    )


def _run(
    services: PipelineServices,
    observation_ids: tuple[int, ...],
    *,
    run_id: UUID | None = None,
    publication_id: UUID | None = None,
    build_sha: str = BUILD_SHA,
    parser_version: str = "eat-v1",
    started_at=REPLAY_STARTED_AT,
    replay_services: ReplayServices | None = None,
):
    return replay_observations(
        run_id=uuid4() if run_id is None else run_id,
        publication_id=uuid4() if publication_id is None else publication_id,
        observation_ids=observation_ids,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
        normalized_at=NORMALIZED_AT,
        validated_at=VALIDATED_AT,
        activated_at=ACTIVATED_AT,
        services=_services(services) if replay_services is None else replay_services,
    )


def _start_validated_replay(
    services: PipelineServices,
    observation_ids: tuple[int, ...],
):
    run_id, publication_id = uuid4(), uuid4()
    services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    records = tuple(
        normalize_observation(
            processing_run_id=run_id,
            observation_id=observation_id,
            parser_version="eat-v1",
            normalized_at=NORMALIZED_AT,
            store=services.store,
            repository=services.normalization_repository,
        )
        for observation_id in observation_ids
    )
    validation = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=services.publication_repository,
    )
    assert validation.status == "validated"
    return run_id, publication_id, records


def test_same_replay_run_resumes_without_duplicate_state(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()

    first = _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    second = _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )

    assert second == first
    assert second.status == "published"
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select count(*) from ingest.publication where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select count(*) from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (1,)


def test_observation_repository_cannot_create_replay_runs(
    pipeline_services: PipelineServices,
) -> None:
    run_id = uuid4()
    with pytest.raises(ValueError, match="ReplayRunRepository"):
        pipeline_services.repository.start_run(
            run_id=run_id,
            mode="replay",
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
            expected_count=1,
        )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from ingest.run where run_id = %s", (run_id,))
        assert cursor.fetchone() == (0,)


def test_capture_repository_cannot_plan_requests_for_existing_replay(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id = uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=uuid4(),
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )

    with pytest.raises(IngestIntegrityError, match="capture mode"):
        pipeline_services.repository.plan_request_unit(
            run_id=run_id,
            source="eat",
            endpoint="bid-detail",
            params={"ELCTRN_BID_ID": "must-not-plan"},
            expected_count=1,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.request_unit where run_id = %s", (run_id,)
        )
        assert cursor.fetchone() == (0,)


def test_capture_repository_cannot_record_raw_evidence_for_existing_replay(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    params = {"ELCTRN_BID_ID": "must-not-capture"}
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            """
            insert into ingest.request_unit (
                run_id, source, endpoint, request_params, request_params_hash,
                expected_count, observed_count, status
            ) values (%s, 'eat', 'bid-detail', %s, %s, 1, 0, 'planned')
            returning request_unit_id
            """,
            (run_id, Jsonb(params), request_params_sha256(params)),
        )
        request_unit_id = int(cursor.fetchone()[0])
    pipeline_services.connection.commit()
    body = b"<must-not-be-owned-by-replay/>"
    stored = pipeline_services.store.put(source="eat", endpoint="bid-detail", body=body)

    with pytest.raises(IngestIntegrityError, match="capture mode"):
        pipeline_services.repository.record_observation(
            request=CaptureRequest(
                request_unit_id=request_unit_id,
                run_id=run_id,
                source="eat",
                endpoint="bid-detail",
                params=params,
            ),
            response=SourceResponse(200, body, NORMALIZED_AT),
            stored=stored,
            failure_category=None,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status, captured_count from ingest.run where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("running", 0)
        cursor.execute(
            "select status, observed_count from ingest.request_unit "
            "where request_unit_id = %s",
            (request_unit_id,),
        )
        assert cursor.fetchone() == ("planned", 0)
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id = %s", (run_id,)
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select count(*) from ingest.raw_blob where content_sha256 = %s",
            (stored.content_sha256,),
        )
        assert cursor.fetchone() == (0,)
        cursor.execute(
            "select status from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == ("pending",)


def test_capture_repository_cannot_fail_existing_replay(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )

    with pytest.raises(IngestIntegrityError, match="capture mode"):
        pipeline_services.repository.fail_run(
            run_id=run_id,
            failure_category="SOURCE_THROTTLED",
            failed_at=VALIDATED_AT,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.status, r.failure_category, r.ended_at, p.status "
            "from ingest.run r join ingest.publication p using (run_id) "
            "where r.run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("running", None, None, "pending")


@pytest.mark.parametrize("checkpoint", ["manifest", "one-member", "validated"])
def test_replay_resumes_monotonically_from_partial_checkpoints(
    pipeline_services: PipelineServices, checkpoint: str
) -> None:
    observation_ids = _capture(pipeline_services, count=2)
    run_id, publication_id = uuid4(), uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    if checkpoint in {"one-member", "validated"}:
        normalize_observation(
            processing_run_id=run_id,
            observation_id=observation_ids[0],
            parser_version="eat-v1",
            normalized_at=NORMALIZED_AT,
            store=pipeline_services.store,
            repository=pipeline_services.normalization_repository,
        )
    if checkpoint == "validated":
        normalize_observation(
            processing_run_id=run_id,
            observation_id=observation_ids[1],
            parser_version="eat-v1",
            normalized_at=NORMALIZED_AT,
            store=pipeline_services.store,
            repository=pipeline_services.normalization_repository,
        )
        validation = validate_run(
            run_id=run_id,
            publication_id=publication_id,
            validated_at=VALIDATED_AT,
            repository=pipeline_services.publication_repository,
        )
        assert validation.status == "validated"

    loaded = _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert loaded.status == ("validated" if checkpoint == "validated" else "running")

    result = _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )

    assert result.status == "published"
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (2,)
        cursor.execute(
            "select count(*) from ingest.publication_record where publication_id = %s",
            (publication_id,),
        )
        assert cursor.fetchone() == (2,)


def test_replay_loads_and_resumes_one_of_many_quarantined_checkpoint(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture_pair(pipeline_services, first_body=b"<broken>")
    run_id, publication_id = uuid4(), uuid4()
    _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    with pytest.raises(DataQuarantinedError):
        _normalize_replay_member(
            pipeline_services,
            run_id=run_id,
            observation_id=observation_ids[0],
        )

    loaded = _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert loaded.status == "running"

    with pytest.raises(DataQuarantinedError):
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )
    terminal = _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert (terminal.status, terminal.failure_category) == (
        "failed",
        "DATA_QUARANTINED",
    )


@pytest.mark.parametrize(
    ("attempt_status", "failure_category"),
    [
        ("normalized", "SOURCE_CONTRACT"),
        ("quarantined", "DATA_QUARANTINED"),
    ],
)
def test_incomplete_replay_failure_preserves_structurally_valid_partial_topology(
    pipeline_services: PipelineServices,
    attempt_status: str,
    failure_category: str,
) -> None:
    observation_ids = _capture_pair(
        pipeline_services,
        first_body=b"<broken>" if attempt_status == "quarantined" else None,
    )
    run_id, publication_id = uuid4(), uuid4()
    _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    if attempt_status == "quarantined":
        with pytest.raises(DataQuarantinedError):
            _normalize_replay_member(
                pipeline_services,
                run_id=run_id,
                observation_id=observation_ids[0],
            )
    else:
        _normalize_replay_member(
            pipeline_services,
            run_id=run_id,
            observation_id=observation_ids[0],
        )

    validation = validate_run(
        run_id=run_id,
        publication_id=publication_id,
        validated_at=VALIDATED_AT,
        repository=pipeline_services.publication_repository,
    )
    assert validation.status == "failed"
    loaded = _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert (loaded.status, loaded.failure_category) == ("failed", failure_category)


def test_two_replays_reuse_raw_record_and_revision_with_same_fingerprint(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    raw_count = pipeline_services.store.object_count

    first = _run(pipeline_services, observation_ids)
    second = _run(pipeline_services, observation_ids)

    assert second.canonical_fingerprint == first.canonical_fingerprint
    assert pipeline_services.store.object_count == raw_count
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select count(distinct run_id) from ingest.normalization_attempt "
            "where observation_id = %s",
            (observation_ids[0],),
        )
        assert cursor.fetchone() == (2,)
        cursor.execute(
            "select count(*) from ingest.normalized_record where observation_id = %s",
            (observation_ids[0],),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select count(*) from core.auction_revision ar "
            "join ingest.normalized_record n using (normalized_record_id) "
            "where n.observation_id = %s",
            (observation_ids[0],),
        )
        assert cursor.fetchone() == (1,)
        cursor.execute(
            "select count(*) from ingest.raw_observation where run_id in (%s, %s)",
            (first.run_id, second.run_id),
        )
        assert cursor.fetchone() == (0,)


def test_replay_manifest_is_atomic_sorted_and_rejects_drift(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services, count=2)
    run_id, publication_id = uuid4(), uuid4()
    state = pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=tuple(reversed(observation_ids)),
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    assert state.observation_ids == tuple(sorted(observation_ids))
    assert state.status == "running"

    for changes in (
        {"publication_id": uuid4()},
        {"observation_ids": observation_ids[:1]},
        {"build_sha": "c" * 64},
        {"parser_version": "eat-v2"},
        {"started_at": REPLAY_STARTED_AT + timedelta(seconds=1)},
    ):
        arguments = {
            "run_id": run_id,
            "publication_id": publication_id,
            "observation_ids": observation_ids,
            "build_sha": BUILD_SHA,
            "parser_version": "eat-v1",
            "started_at": REPLAY_STARTED_AT,
        }
        arguments.update(changes)
        with pytest.raises(ReplayIntegrityError):
            pipeline_services.replay_repository.start_or_load(**arguments)


def test_running_replay_rejects_hidden_publication_member(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    foreign = normalize_one(pipeline_services, observation_ids[0])
    run_id, publication_id = uuid4(), uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.publication_record "
            "(publication_id, normalized_record_id) values (%s, %s)",
            (publication_id, foreign.normalized_record_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ReplayIntegrityError, match="publication member"):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )


@pytest.mark.parametrize("state", ["running", "source-contract", "quarantined"])
def test_nonfrozen_replay_states_reject_extra_wrong_parser_attempt(
    pipeline_services: PipelineServices,
    state: str,
) -> None:
    body = (
        _unreviewed_body()
        if state == "source-contract"
        else b"<broken>"
        if state == "quarantined"
        else None
    )
    observation_ids = _capture(pipeline_services, body=body)
    run_id, publication_id = uuid4(), uuid4()
    if state == "running":
        _load_replay_state(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )
    else:
        expected_error = (
            SourceContractError if state == "source-contract" else DataQuarantinedError
        )
        with pytest.raises(expected_error):
            _run(
                pipeline_services,
                observation_ids,
                run_id=run_id,
                publication_id=publication_id,
            )
    _insert_quarantined_attempt(
        pipeline_services,
        run_id=run_id,
        observation_id=observation_ids[0],
        parser_version="eat-v2",
    )

    with pytest.raises(ReplayIntegrityError, match="partial topology"):
        _load_replay_state(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )


@pytest.mark.parametrize(
    "tamper", ["foreign-attempt", "quarantined-foreign-edge", "two-zero"]
)
def test_running_replay_rejects_structurally_incoherent_partial_topology(
    pipeline_services: PipelineServices,
    tamper: str,
) -> None:
    if tamper == "quarantined-foreign-edge":
        observation_ids = _capture_pair(pipeline_services, first_body=b"<broken>")
    else:
        observation_ids = _capture(pipeline_services, count=2)
    run_id, publication_id = uuid4(), uuid4()
    _load_replay_state(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )

    if tamper == "foreign-attempt":
        foreign_observation_id = _capture(pipeline_services)[0]
        _insert_quarantined_attempt(
            pipeline_services,
            run_id=run_id,
            observation_id=foreign_observation_id,
            parser_version="eat-v1",
        )
    elif tamper == "quarantined-foreign-edge":
        with pytest.raises(DataQuarantinedError):
            _normalize_replay_member(
                pipeline_services,
                run_id=run_id,
                observation_id=observation_ids[0],
            )
        normalized = _normalize_replay_member(
            pipeline_services,
            run_id=run_id,
            observation_id=observation_ids[1],
        )
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                "select normalization_attempt_id from ingest.normalization_attempt "
                "where run_id = %s and observation_id = %s",
                (run_id, observation_ids[0]),
            )
            quarantined_attempt_id = int(cursor.fetchone()[0])
            cursor.execute(
                "insert into ingest.normalization_attempt_record "
                "(normalization_attempt_id, normalized_record_id) values (%s, %s)",
                (quarantined_attempt_id, normalized.normalized_record_id),
            )
        pipeline_services.connection.commit()
    else:
        records = tuple(
            _normalize_replay_member(
                pipeline_services,
                run_id=run_id,
                observation_id=observation_id,
            )
            for observation_id in observation_ids
        )
        replace_attempt_record_edges(
            pipeline_services,
            records,
            topology="two-zero",  # type: ignore[arg-type]
        )

    with pytest.raises(ReplayIntegrityError, match="partial topology"):
        _load_replay_state(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )


@pytest.mark.parametrize("failure_kind", ["quarantine", "source-contract"])
def test_stored_failed_replay_cannot_hide_publication_members_before_typed_rethrow(
    pipeline_services: PipelineServices, failure_kind: str
) -> None:
    foreign_observation = _capture(pipeline_services)
    foreign = normalize_one(pipeline_services, foreign_observation[0])
    if failure_kind == "quarantine":
        replay_observations_ids = _capture(pipeline_services, body=b"<broken>")
        expected_error = DataQuarantinedError
    else:
        body = (
            FIXTURE.read_bytes()
            .replace(
                b"</ColumnInfo>",
                b'<Column id="UNREVIEWED_FIELD" type="STRING"/></ColumnInfo>',
                1,
            )
            .replace(b"</Row>", b'<Col id="UNREVIEWED_FIELD">new</Col></Row>', 1)
        )
        replay_observations_ids = _capture(pipeline_services, body=body)
        expected_error = SourceContractError
    run_id, publication_id = uuid4(), uuid4()
    with pytest.raises(expected_error):
        _run(
            pipeline_services,
            replay_observations_ids,
            run_id=run_id,
            publication_id=publication_id,
        )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.publication_record "
            "(publication_id, normalized_record_id) values (%s, %s)",
            (publication_id, foreign.normalized_record_id),
        )
    pipeline_services.connection.commit()

    class NoRawAccess:
        def put(self, **_kwargs: object):
            raise AssertionError("failed replay must not write raw")

        def read(self, _object_key: str) -> bytes:
            raise AssertionError("integrity check must precede typed failure rethrow")

    with pytest.raises(ReplayIntegrityError, match="publication member"):
        _run(
            pipeline_services,
            replay_observations_ids,
            run_id=run_id,
            publication_id=publication_id,
            replay_services=_services(pipeline_services, store=NoRawAccess()),
        )


@pytest.mark.parametrize(
    "tamper", ["missing-member", "extra-member", "swapped-edge", "wrong-parser"]
)
def test_validated_replay_start_rechecks_exact_shared_topology_and_members(
    pipeline_services: PipelineServices, tamper: str
) -> None:
    observation_ids = _capture(pipeline_services, count=2)
    run_id, publication_id, records = _start_validated_replay(
        pipeline_services, observation_ids
    )
    if tamper == "missing-member":
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                "delete from ingest.publication_record "
                "where publication_id = %s and normalized_record_id = %s",
                (publication_id, records[0].normalized_record_id),
            )
        pipeline_services.connection.commit()
    elif tamper == "extra-member":
        foreign_observation = _capture(pipeline_services)
        foreign = normalize_one(pipeline_services, foreign_observation[0])
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                "insert into ingest.publication_record "
                "(publication_id, normalized_record_id) values (%s, %s)",
                (publication_id, foreign.normalized_record_id),
            )
        pipeline_services.connection.commit()
    elif tamper == "swapped-edge":
        replace_attempt_record_edges(
            pipeline_services, (records[0], records[1]), topology="swapped"
        )
    else:
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(
                """
                insert into ingest.normalization_attempt (
                    run_id, observation_id, parser_version, status, attempted_at,
                    schema_fingerprint, quarantine_reason
                ) values (%s, %s, 'eat-v2', 'quarantined', %s, null, 'tamper')
                """,
                (run_id, observation_ids[0], VALIDATED_AT),
            )
        pipeline_services.connection.commit()

    with pytest.raises(ReplayIntegrityError, match="topology|publication member"):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )


def test_projection_failed_replay_still_requires_exact_frozen_members(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id, records = _start_validated_replay(
        pipeline_services, observation_ids
    )

    def invalid_projection(member):
        return replace(
            build_eat_auction_projection(member), normalized_payload_sha256="0" * 64
        )

    with pytest.raises(ProjectionContractError):
        pipeline_services.projection_repository.project_publication(
            publication_id=publication_id,
            projector_version=BUILD_SHA,
            activated_at=ACTIVATED_AT,
            projection_factory=invalid_projection,
        )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "delete from ingest.publication_record "
            "where publication_id = %s and normalized_record_id = %s",
            (publication_id, records[0].normalized_record_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ReplayIntegrityError, match="publication member"):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )


def test_published_replay_start_rejects_extra_frozen_member(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()
    _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    foreign_observation = _capture(pipeline_services)
    foreign = normalize_one(pipeline_services, foreign_observation[0])
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "insert into ingest.publication_record "
            "(publication_id, normalized_record_id) values (%s, %s)",
            (publication_id, foreign.normalized_record_id),
        )
    pipeline_services.connection.commit()

    with pytest.raises(ReplayIntegrityError, match="publication member"):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )


def test_replay_start_rejects_ambient_transaction_ownership(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select 1")
        assert cursor.fetchone() == (1,)
    with pytest.raises(ReplayTransactionScopeError, match="idle"):
        pipeline_services.replay_repository.start_or_load(
            run_id=uuid4(),
            publication_id=uuid4(),
            observation_ids=observation_ids,
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )
    pipeline_services.connection.rollback()


def test_replay_load_and_validation_share_a_deadlock_free_lock_order(
    pipeline_services: PipelineServices, migrated_db: MigratedDatabase
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()
    pipeline_services.replay_repository.start_or_load(
        run_id=run_id,
        publication_id=publication_id,
        observation_ids=observation_ids,
        build_sha=BUILD_SHA,
        parser_version="eat-v1",
        started_at=REPLAY_STARTED_AT,
    )
    suffix = uuid4().hex
    function_name = f"replay_insert_gate_{suffix}"
    trigger_name = f"replay_insert_gate_{suffix}"
    advisory_key = int(suffix[:12], 16)
    application_name = f"eatbid-replay-lock-{suffix}"
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            f"""
            create function public.{function_name}() returns trigger
            language plpgsql as $$
            begin
                if new.run_id = '{run_id}'::uuid then
                    perform pg_advisory_xact_lock({advisory_key});
                end if;
                return new;
            end
            $$
            """
        )
        cursor.execute(
            f"""
            create trigger {trigger_name}
            before insert on ingest.run
            for each row execute function public.{function_name}()
            """
        )
    pipeline_services.connection.commit()

    blocker = migrated_db.connect()
    observer = migrated_db.connect()
    observer.autocommit = True
    blocker.execute("select pg_advisory_lock(%s)", (advisory_key,))
    start_result: ReplayRunState | None = None
    validation_result = None
    caught: Exception | None = None

    def load_replay() -> ReplayRunState:
        with migrated_db.connect() as connection:
            connection.execute(
                "select set_config('application_name', %s, false)",
                (application_name,),
            )
            connection.commit()
            return type(pipeline_services.replay_repository)(connection).start_or_load(
                run_id=run_id,
                publication_id=publication_id,
                observation_ids=observation_ids,
                build_sha=BUILD_SHA,
                parser_version="eat-v1",
                started_at=REPLAY_STARTED_AT,
            )

    def validate_replay():
        with migrated_db.connect() as connection:
            return validate_run(
                run_id=run_id,
                publication_id=publication_id,
                validated_at=VALIDATED_AT,
                repository=PsycopgPublicationRepository(connection),
            )

    executor = ThreadPoolExecutor(max_workers=2)
    start_future = executor.submit(load_replay)
    validation_future = None
    try:
        deadline = time.monotonic() + 3
        waiting = False
        while time.monotonic() < deadline:
            row = observer.execute(
                "select wait_event from pg_stat_activity where application_name = %s",
                (application_name,),
            ).fetchone()
            if row == ("advisory",):
                waiting = True
                break
            time.sleep(0.02)
        assert waiting, "controlled replay insert never reached the advisory gate"

        validation_future = executor.submit(validate_replay)
        try:
            validation_result = validation_future.result(timeout=3)
        except Exception as error:  # noqa: BLE001 - cleanup must release the gate
            caught = error
    finally:
        blocker.execute("select pg_advisory_unlock(%s)", (advisory_key,))
        blocker.commit()
        try:
            start_result = start_future.result(timeout=6)
        except Exception as error:  # noqa: BLE001 - preserve failure through cleanup
            caught = caught or error
        if validation_future is not None and not validation_future.done():
            try:
                validation_result = validation_future.result(timeout=6)
            except Exception as error:  # noqa: BLE001 - preserve failure through cleanup
                caught = caught or error
        executor.shutdown(wait=True, cancel_futures=True)
        observer.close()
        blocker.close()
        with pipeline_services.connection.cursor() as cursor:
            cursor.execute(f"drop trigger if exists {trigger_name} on ingest.run")
            cursor.execute(f"drop function if exists public.{function_name}()")
        pipeline_services.connection.commit()

    if caught is not None:
        if isinstance(caught, FutureTimeoutError):
            pytest.fail(
                "replay/validation lock order did not complete within the bound"
            )
        raise caught
    assert validation_result is not None
    assert validation_result.status == "failed"
    assert start_result is not None
    assert start_result.status == "failed"


@pytest.mark.parametrize("same_identity", [True, False])
def test_concurrent_replay_start_is_atomic_for_same_or_conflicting_identity(
    pipeline_services: PipelineServices,
    migrated_db: MigratedDatabase,
    same_identity: bool,
) -> None:
    observation_ids = _capture(pipeline_services, count=2)
    run_id = uuid4()
    first_publication_id = uuid4()
    second_publication_id = first_publication_id if same_identity else uuid4()
    barrier = Barrier(2)

    def invoke(publication_id: UUID) -> ReplayRunState:
        with migrated_db.connect() as connection:
            repository = type(pipeline_services.replay_repository)(connection)
            barrier.wait()
            return repository.start_or_load(
                run_id=run_id,
                publication_id=publication_id,
                observation_ids=observation_ids,
                build_sha=BUILD_SHA,
                parser_version="eat-v1",
                started_at=REPLAY_STARTED_AT,
            )

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = (
            executor.submit(invoke, first_publication_id),
            executor.submit(invoke, second_publication_id),
        )
        states: list[ReplayRunState] = []
        errors: list[ReplayIntegrityError] = []
        for future in futures:
            try:
                states.append(future.result(timeout=6))
            except ReplayIntegrityError as error:
                errors.append(error)

    if same_identity:
        assert len(states) == 2
        assert states[0] == states[1]
        assert errors == []
    else:
        assert len(states) == 1
        assert len(errors) == 1
        assert "identity metadata differs" in str(errors[0])

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select publication_id from ingest.publication where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchall() == [(states[0].publication_id,)]
        cursor.execute(
            "select observation_id from ingest.replay_input "
            "where run_id = %s order by observation_id",
            (run_id,),
        )
        assert tuple(int(row[0]) for row in cursor.fetchall()) == observation_ids


@pytest.mark.parametrize("observation_ids", [(), (1, 1), (True,), (0,), (-1,)])
def test_invalid_replay_manifest_makes_no_run(
    pipeline_services: PipelineServices, observation_ids: tuple[object, ...]
) -> None:
    run_id = uuid4()
    with pytest.raises((TypeError, ValueError)):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=uuid4(),
            observation_ids=observation_ids,  # type: ignore[arg-type]
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )
    with pipeline_services.connection.cursor() as cursor:
        cursor.execute("select count(*) from ingest.run where run_id = %s", (run_id,))
        assert cursor.fetchone() == (0,)


def test_unknown_replay_observation_rolls_back_run_publication_and_manifest(
    pipeline_services: PipelineServices,
) -> None:
    run_id, publication_id = uuid4(), uuid4()
    with pytest.raises(ReplayIntegrityError, match="observation"):
        pipeline_services.replay_repository.start_or_load(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=(2**62,),
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=REPLAY_STARTED_AT,
        )
    with pipeline_services.connection.cursor() as cursor:
        for table, key in (
            ("ingest.run", "run_id"),
            ("ingest.publication", "publication_id"),
            ("ingest.replay_input", "run_id"),
        ):
            cursor.execute(
                f"select count(*) from {table} where {key} = %s",
                (run_id if key == "run_id" else publication_id,),
            )
            assert cursor.fetchone() == (0,)


def test_input_order_does_not_change_replay_fingerprint(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services, count=2)

    forward = _run(pipeline_services, observation_ids)
    reverse = _run(pipeline_services, tuple(reversed(observation_ids)))

    assert reverse.canonical_fingerprint == forward.canonical_fingerprint


def test_transient_raw_read_failure_leaves_frozen_running_run_retryable(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()

    class FailingReadStore:
        def put(self, **_kwargs: object):
            raise AssertionError("replay must not write raw evidence")

        def read(self, _object_key: str) -> bytes:
            raise RuntimeError("transient R2 failure")

    with pytest.raises(RuntimeError, match="transient R2"):
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
            replay_services=_services(pipeline_services, store=FailingReadStore()),
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.status, p.status, r.failure_category "
            "from ingest.run r join ingest.publication p using (run_id) "
            "where r.run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("running", "pending", None)
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (0,)
    pipeline_services.connection.commit()

    recovered = _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert recovered.status == "published"


def test_transient_database_failure_propagates_without_terminal_state(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()

    class FailingNormalizationRepository:
        def load_observation(self, **_kwargs: object):
            raise psycopg.OperationalError("transient database failure")

        def store_normalized(self, **_kwargs: object):
            raise AssertionError("store must not follow a failed load")

        def quarantine(self, **_kwargs: object):
            raise AssertionError("operational errors are not quarantined")

    services = ReplayServices(
        replay_repository=pipeline_services.replay_repository,
        normalization_repository=FailingNormalizationRepository(),  # type: ignore[arg-type]
        publication_repository=pipeline_services.publication_repository,
        projection_repository=pipeline_services.projection_repository,
        store=pipeline_services.store,
    )
    with pytest.raises(psycopg.OperationalError, match="transient database"):
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
            replay_services=services,
        )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.status, p.status, r.failure_category "
            "from ingest.run r join ingest.publication p using (run_id) "
            "where r.run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("running", "pending", None)
        cursor.execute(
            "select count(*) from ingest.normalization_attempt where run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == (0,)


def test_quarantined_replay_persists_and_rethrows_data_failure(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services, body=b"<broken>")
    run_id, publication_id = uuid4(), uuid4()

    with pytest.raises(DataQuarantinedError) as caught:
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )
    assert caught.value.exit_code == 65
    assert caught.value.observation_id == observation_ids[0]

    class NoRawAccess:
        def put(self, **_kwargs: object):
            raise AssertionError("failed replay re-entry must not write raw")

        def read(self, _object_key: str) -> bytes:
            raise AssertionError("failed replay re-entry must not read raw")

    with pytest.raises(DataQuarantinedError) as caught:
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
            replay_services=_services(pipeline_services, store=NoRawAccess()),
        )
    assert caught.value.exit_code == 65
    assert caught.value.observation_id == observation_ids[0]

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.status, p.status, r.failure_category "
            "from ingest.run r join ingest.publication p using (run_id) "
            "where r.run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("failed", "failed", "DATA_QUARANTINED")
        cursor.execute(
            "select count(*) from core.auction_revision ar "
            "join ingest.normalized_record n using (normalized_record_id) "
            "where n.observation_id = %s",
            (observation_ids[0],),
        )
        assert cursor.fetchone() == (0,)


def test_unreviewed_schema_replay_persists_and_rethrows_source_contract(
    pipeline_services: PipelineServices,
) -> None:
    body = (
        FIXTURE.read_bytes()
        .replace(
            b"</ColumnInfo>",
            b'<Column id="UNREVIEWED_FIELD" type="STRING"/></ColumnInfo>',
            1,
        )
        .replace(b"</Row>", b'<Col id="UNREVIEWED_FIELD">new</Col></Row>', 1)
    )
    observation_ids = _capture(pipeline_services, body=body)
    run_id, publication_id = uuid4(), uuid4()

    for _ in range(2):
        with pytest.raises(SourceContractError):
            _run(
                pipeline_services,
                observation_ids,
                run_id=run_id,
                publication_id=publication_id,
            )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select r.status, p.status, r.failure_category "
            "from ingest.run r join ingest.publication p using (run_id) "
            "where r.run_id = %s",
            (run_id,),
        )
        assert cursor.fetchone() == ("failed", "failed", "SOURCE_CONTRACT")


def test_published_reentry_reverifies_canonical_relations(
    pipeline_services: PipelineServices,
) -> None:
    observation_ids = _capture(pipeline_services)
    run_id, publication_id = uuid4(), uuid4()
    result = _run(
        pipeline_services,
        observation_ids,
        run_id=run_id,
        publication_id=publication_id,
    )
    assert result.status == "published"

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select auction_revision_id from core.auction_revision ar "
            "join ingest.publication_record pr using (normalized_record_id) "
            "where pr.publication_id = %s",
            (publication_id,),
        )
        revision_id = cursor.fetchone()[0]
        cursor.execute(
            "delete from core.auction_revision_code_value "
            "where auction_revision_id = %s and role = 'location_sido'",
            (revision_id,),
        )
        assert cursor.rowcount == 1
    pipeline_services.connection.commit()

    with pytest.raises(ProjectionContractError):
        _run(
            pipeline_services,
            observation_ids,
            run_id=run_id,
            publication_id=publication_id,
        )
