from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace
from uuid import UUID, uuid4

import psycopg
import pytest

from eatbid.composition import Application
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.release_repository import (
    ReleaseObservationMembershipError,
    ReleaseSealedError,
)
from eatbid.pipeline.capture import capture
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.normalize import normalize_observation
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import MigratedDatabase, PipelineServices

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-list-one.xml"
DETAIL_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
RUN_ID = UUID("42000000-0000-0000-0000-000000000001")
RELEASE_ID = UUID("42000000-0000-0000-0000-000000000002")
DETAIL_RUN_ID = UUID("42000000-0000-0000-0000-000000000003")
PUBLICATION_ID = UUID("42000000-0000-0000-0000-000000000004")
NOW = datetime(2026, 9, 1, 2, 0, tzinfo=UTC)


def test_offline_discover가_raw와_detail_manifest를_같은_planned_release에_연결한다(
    pipeline_services: PipelineServices,
    migrated_db: MigratedDatabase,
) -> None:
    client = StaticSourceClient(SourceResponse(200, FIXTURE.read_bytes(), NOW))
    release_repository = PsycopgSourceReleaseRepository(
        pipeline_services.connection
    )
    persistence = RawFirstDiscoveryPersistence(
        ingest_repository=pipeline_services.repository,
        release_repository=release_repository,
        raw_store=pipeline_services.store,
    )

    result = discover_release(
        DiscoveryPlan(
            source_release_id=RELEASE_ID,
            run_id=RUN_ID,
            detail_run_id=DETAIL_RUN_ID,
            release_name="R0 offline fixture",
            as_of=NOW,
            build_sha="a" * 64,
            parser_version="eat-v1",
            started_at=NOW,
            completed_at=NOW,
            start_date="20260901",
            end_date="20260901",
            progress_status_code="",
            region_code="",
            page_size=100,
            page_budget=1,
        ),
        persistence,
        client,
    )

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select expected_count, captured_count, status from ingest.run where run_id = %s",
            (RUN_ID,),
        )
        run = cursor.fetchone()
        cursor.execute(
            "select expected_count, captured_count, status from ingest.run where run_id = %s",
            (DETAIL_RUN_ID,),
        )
        detail_run = cursor.fetchone()
        cursor.execute(
            "select status, manifest_sha256 from ingest.source_release where source_release_id = %s",
            (RELEASE_ID,),
        )
        release = cursor.fetchone()
        cursor.execute(
            "select observation_id from ingest.source_release_observation where source_release_id = %s",
            (RELEASE_ID,),
        )
        members = cursor.fetchall()
        cursor.execute(
            """
            select request_params ->> 'ELCTRN_BID_ID', status
            from ingest.request_unit where run_id = %s order by request_unit_id
            """,
            (DETAIL_RUN_ID,),
        )
        detail_manifest = cursor.fetchall()
    pipeline_services.connection.commit()

    assert result.external_bid_ids == ("5610615",)
    assert run == (1, 1, "validated")
    assert detail_run == (1, 0, "running")
    assert release == ("planned", None)
    assert detail_manifest == [("5610615", "planned")]
    assert members == [(result.observation_ids[0],)]
    assert len(client.requests) == 1
    with pytest.raises(ReleaseObservationMembershipError):
        release_repository.load_preplanned_detail_request(
            RELEASE_ID, uuid4(), "5610615"
        )

    application = Application(
        connection=pipeline_services.connection,
        http_client=StaticSourceClient(
            SourceResponse(200, DETAIL_FIXTURE.read_bytes(), NOW)
        ),
        raw_store=pipeline_services.store,
        ingest_repository=pipeline_services.repository,
        release_repository=release_repository,
        normalization_repository=pipeline_services.normalization_repository,
        publication_repository=pipeline_services.publication_repository,
        replay_repository=pipeline_services.replay_repository,
        projection_repository=pipeline_services.projection_repository,
    )
    detail = application.capture(
        SimpleNamespace(
            source_release_id=RELEASE_ID,
            run_id=DETAIL_RUN_ID,
            external_bid_id="5610615",
        )
    )
    retried_detail = application.capture(
        SimpleNamespace(
            source_release_id=RELEASE_ID,
            run_id=DETAIL_RUN_ID,
            external_bid_id="5610615",
        )
    )
    assert retried_detail == detail
    captured_unit = release_repository.load_preplanned_detail_request(
        RELEASE_ID, DETAIL_RUN_ID, "5610615"
    )
    release_repository.require_processing_observation(
        RELEASE_ID, DETAIL_RUN_ID, detail.observation_id
    )
    with pytest.raises(ReleaseObservationMembershipError):
        release_repository.require_processing_observation(
            RELEASE_ID, uuid4(), detail.observation_id
        )
    normalize_observation(
        processing_run_id=DETAIL_RUN_ID,
        observation_id=detail.observation_id,
        parser_version="eat-v1",
        normalized_at=NOW,
        store=pipeline_services.store,
        repository=pipeline_services.normalization_repository,
    )
    publication = validate_run(
        run_id=DETAIL_RUN_ID,
        publication_id=PUBLICATION_ID,
        validated_at=NOW,
        repository=pipeline_services.publication_repository,
    )
    with pytest.raises(ReleaseObservationMembershipError):
        application.project(
            SimpleNamespace(
                source_release_id=RELEASE_ID,
                run_id=DETAIL_RUN_ID,
                publication_id=PUBLICATION_ID,
                build_sha="a" * 64,
                activated_at=NOW,
            )
        )
    unrelated_run_id = uuid4()
    pipeline_services.repository.start_run(
        run_id=unrelated_run_id,
        mode="backfill",
        build_sha="a" * 64,
        parser_version="eat-v1",
        started_at=NOW,
        expected_count=1,
    )
    unrelated_unit = pipeline_services.repository.plan_request_unit(
        run_id=unrelated_run_id,
        source="eat",
        endpoint="bid-detail",
        params={"ELCTRN_BID_ID": "9999999"},
        expected_count=1,
    )
    unrelated = capture(
        CaptureRequest(
            unrelated_unit.request_unit_id,
            unrelated_unit.run_id,
            unrelated_unit.source,
            unrelated_unit.endpoint,
            unrelated_unit.params,
        ),
        pipeline_services.store,
        pipeline_services.repository,
        StaticSourceClient(SourceResponse(200, DETAIL_FIXTURE.read_bytes(), NOW)),
    )
    sealed = _봉인과_비회원_attach_race를_실행한다(
        migrated_db,
        detail_request_unit_id=captured_unit.request_unit_id,
        unrelated_observation_id=unrelated.observation_id,
    )
    release_repository.require_publication_corpus(
        RELEASE_ID, DETAIL_RUN_ID, PUBLICATION_ID
    )
    with pytest.raises(ReleaseObservationMembershipError):
        release_repository.require_publication_corpus(
            RELEASE_ID, uuid4(), PUBLICATION_ID
        )

    assert len(sealed.manifest_sha256) == 64
    assert publication.status == "validated"


def _봉인과_비회원_attach_race를_실행한다(
    migrated_db: MigratedDatabase,
    *,
    detail_request_unit_id: int,
    unrelated_observation_id: int,
) -> object:
    blocker = migrated_db.connect()
    reconciler_connection = migrated_db.connect()
    attacker_connection = migrated_db.connect()
    control = migrated_db.connect()
    try:
        with reconciler_connection.cursor() as cursor:
            cursor.execute("select pg_backend_pid()")
            reconciler_pid = int(cursor.fetchone()[0])
        reconciler_connection.commit()
        with ThreadPoolExecutor(max_workers=2) as executor:
            with blocker.transaction(), blocker.cursor() as cursor:
                cursor.execute(
                    "select request_unit_id from ingest.request_unit "
                    "where request_unit_id = %s for update",
                    (detail_request_unit_id,),
                )
                seal_future = executor.submit(
                    PsycopgSourceReleaseRepository(
                        reconciler_connection
                    ).reconcile_and_seal,
                    RELEASE_ID,
                    DETAIL_RUN_ID,
                    sealed_at=NOW,
                )
                _잠금대기를_기다린다(control, reconciler_pid)
                attach_future = executor.submit(
                    PsycopgSourceReleaseRepository(
                        attacker_connection
                    ).attach_observation,
                    RELEASE_ID,
                    unrelated_observation_id,
                )
                time.sleep(0.1)
                assert not attach_future.done()
            sealed = seal_future.result(timeout=10)
            with pytest.raises(ReleaseSealedError):
                attach_future.result(timeout=10)
            return sealed
    finally:
        control.close()
        attacker_connection.close()
        reconciler_connection.close()
        blocker.close()


def _잠금대기를_기다린다(
    connection: psycopg.Connection[tuple[object, ...]], backend_pid: int
) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with connection.cursor() as cursor:
            cursor.execute(
                "select wait_event_type from pg_stat_activity where pid = %s",
                (backend_pid,),
            )
            row = cursor.fetchone()
        connection.commit()
        if row is not None and row[0] == "Lock":
            return
        time.sleep(0.05)
    raise AssertionError("reconcile transaction이 request unit lock을 기다리지 않았다")
