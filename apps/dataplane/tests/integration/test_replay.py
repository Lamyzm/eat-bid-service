from __future__ import annotations

from datetime import timedelta
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.core.repository import ProjectionContractError
from eatbid.errors import SourceContractError
from eatbid.ingest.postgres_replay_repository import (
    ReplayIntegrityError,
    ReplayTransactionScopeError,
)
from eatbid.pipeline.normalize import DataQuarantinedError, normalize_observation
from eatbid.pipeline.replay import ReplayServices, replay_observations
from eatbid.pipeline.validate import validate_run

from .conftest import PipelineServices
from .test_normalize_validate import (
    BUILD_SHA,
    FETCHED_AT,
    NORMALIZED_AT,
    VALIDATED_AT,
    capture_detail,
    start_run,
)

ACTIVATED_AT = VALIDATED_AT + timedelta(minutes=1)
REPLAY_STARTED_AT = FETCHED_AT + timedelta(seconds=1)
FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"


def _services(services: PipelineServices, *, store: object | None = None) -> ReplayServices:
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


@pytest.mark.parametrize(
    "checkpoint", ["manifest", "one-member", "validated"]
)
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
            cursor.execute(f"select count(*) from {table} where {key} = %s", (run_id if key == "run_id" else publication_id,))
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
    body = FIXTURE.read_bytes().replace(
        b"</ColumnInfo>",
        b'<Column id="UNREVIEWED_FIELD" type="STRING"/></ColumnInfo>',
        1,
    ).replace(
        b"</Row>", b'<Col id="UNREVIEWED_FIELD">new</Col></Row>', 1
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
