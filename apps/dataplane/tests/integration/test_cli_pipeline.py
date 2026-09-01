from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from uuid import UUID

from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.discovery_persistence import RawFirstDiscoveryPersistence
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import PipelineServices

FIXTURE = Path(__file__).parents[1] / "fixtures" / "eat" / "bid-list-one.xml"
RUN_ID = UUID("42000000-0000-0000-0000-000000000001")
RELEASE_ID = UUID("42000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 9, 1, 2, 0, tzinfo=UTC)


def test_offline_discover가_raw_observation과_봉인_release를_연결한다(
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
            "select status, manifest_sha256 from ingest.source_release where source_release_id = %s",
            (RELEASE_ID,),
        )
        release = cursor.fetchone()
        cursor.execute(
            "select observation_id from ingest.source_release_observation where source_release_id = %s",
            (RELEASE_ID,),
        )
        members = cursor.fetchall()

    assert result.external_bid_ids == ("5610615",)
    assert run == (1, 1, "running")
    assert release == ("sealed", result.manifest_sha256)
    assert members == [(result.observation_ids[0],)]
    assert len(client.requests) == 1
