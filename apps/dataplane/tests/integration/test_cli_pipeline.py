from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.ingest.release_repository import ReleaseObservationMembershipError
from eatbid.pipeline.capture import capture
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.pipeline.normalize import normalize_observation
from eatbid.pipeline.validate import validate_run
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import PipelineServices

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-list-one.xml"
DETAIL_FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-detail-one.xml"
RUN_ID = UUID("42000000-0000-0000-0000-000000000001")
RELEASE_ID = UUID("42000000-0000-0000-0000-000000000002")
DETAIL_RUN_ID = UUID("42000000-0000-0000-0000-000000000003")
PUBLICATION_ID = UUID("42000000-0000-0000-0000-000000000004")
NOW = datetime(2026, 9, 1, 2, 0, tzinfo=UTC)


def test_offline_discover가_raw와_detail_manifest를_같은_planned_release에_연결한다(
    pipeline_services: PipelineServices,
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

    planned = release_repository.load_preplanned_detail_request(
        RELEASE_ID, DETAIL_RUN_ID, "5610615"
    )
    detail = capture(
        CaptureRequest(
            planned.request_unit_id,
            planned.run_id,
            planned.source,
            planned.endpoint,
            planned.params,
        ),
        pipeline_services.store,
        pipeline_services.repository,
        StaticSourceClient(SourceResponse(200, DETAIL_FIXTURE.read_bytes(), NOW)),
    )
    release_repository.attach_observation(RELEASE_ID, detail.observation_id)
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
    sealed = release_repository.reconcile_and_seal(
        RELEASE_ID, DETAIL_RUN_ID, sealed_at=NOW
    )
    publication = validate_run(
        run_id=DETAIL_RUN_ID,
        publication_id=PUBLICATION_ID,
        validated_at=NOW,
        repository=pipeline_services.publication_repository,
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
