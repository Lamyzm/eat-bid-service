from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest

from eatbid.cli import main
from eatbid.composition import Application
from eatbid.ingest.postgres_release_repository import PsycopgSourceReleaseRepository
from eatbid.source.client import SourceResponse

from ..unit.fakes import StaticSourceClient
from .conftest import PipelineServices

FIXTURES = Path(__file__).parents[1] / "fixtures" / "eat"
NOW = datetime(2026, 9, 1, 4, 0, tzinfo=UTC)
SHA = "a" * 64


class _빌린애플리케이션:
    def __init__(self, application: Application) -> None:
        self._application = application

    def __enter__(self) -> Application:
        return self._application

    def __exit__(self, *args: object) -> None:
        return None


def _공통(command: str, run_id: object, release_id: object) -> list[str]:
    return [
        command,
        "--run-id", str(run_id),
        "--source-release-id", str(release_id),
        "--build-sha", SHA,
        "--parser-version", "eat-v1",
    ]


def test_actual_CLI가_discover부터_validate_복구와_project까지_실행한다(
    pipeline_services: PipelineServices,
    capsys: pytest.CaptureFixture[str],
) -> None:
    release_id, discovery_run_id, detail_run_id = uuid4(), uuid4(), uuid4()
    publication_id = uuid4()
    source = StaticSourceClient(
        SourceResponse(200, (FIXTURES / "bid-list-one.xml").read_bytes(), NOW)
    )
    release_repository = PsycopgSourceReleaseRepository(
        pipeline_services.connection
    )
    application = Application(
        connection=pipeline_services.connection,
        http_client=source,
        raw_store=pipeline_services.store,
        ingest_repository=pipeline_services.repository,
        release_repository=release_repository,
        normalization_repository=pipeline_services.normalization_repository,
        publication_repository=pipeline_services.publication_repository,
        replay_repository=pipeline_services.replay_repository,
        projection_repository=pipeline_services.projection_repository,
    )
    factory = lambda _: _빌린애플리케이션(application)
    settings: Any = object()

    discover = _공통("discover", discovery_run_id, release_id) + [
        "--detail-run-id", str(detail_run_id),
        "--mode", "backfill",
        "--release-name", "실제 CLI E2E",
        "--as-of", NOW.isoformat(),
        "--started-at", NOW.isoformat(),
        "--completed-at", NOW.isoformat(),
        "--start-date", "20260901",
        "--end-date", "20260901",
        "--page-size", "100",
    ]
    assert main(discover, application_factory=factory, settings=settings) == 0
    discovered = json.loads(capsys.readouterr().out)
    assert discovered["source_release_id"] == str(release_id)
    assert discovered["detail_run_id"] == str(detail_run_id)
    assert discovered["discovered_count"] == 1

    source.response = SourceResponse(
        200, (FIXTURES / "bid-detail-one.xml").read_bytes(), NOW
    )
    capture_args = _공통("capture", detail_run_id, release_id) + [
        "--external-bid-id", "5610615",
        "--started-at", NOW.isoformat(),
    ]
    assert main(capture_args, application_factory=factory, settings=settings) == 0
    captured = json.loads(capsys.readouterr().out)
    observation_id = int(captured["observation_id"])
    assert len(captured["content_sha256"]) == 64

    normalize_args = _공통("normalize", detail_run_id, release_id) + [
        "--observation-id", str(observation_id),
        "--normalized-at", NOW.isoformat(),
    ]
    assert main(normalize_args, application_factory=factory, settings=settings) == 0

    # publication 직전 crash 상태를 영속화하고 같은 CLI가 sealed corpus를 재검증해 복구한다.
    release_repository.reconcile_and_seal(
        release_id, detail_run_id, sealed_at=NOW
    )
    validate_args = _공통("validate", detail_run_id, release_id) + [
        "--publication-id", str(publication_id),
        "--validated-at", NOW.isoformat(),
    ]
    assert main(validate_args, application_factory=factory, settings=settings) == 0
    assert main(validate_args, application_factory=factory, settings=settings) == 0

    project_args = _공통("project", detail_run_id, release_id) + [
        "--publication-id", str(publication_id),
        "--activated-at", NOW.isoformat(),
    ]
    assert main(project_args, application_factory=factory, settings=settings) == 0

    replay_args = _공통("replay", uuid4(), release_id) + [
        "--publication-id", str(uuid4()),
        "--observation-id", str(observation_id),
        "--started-at", NOW.isoformat(),
        "--normalized-at", NOW.isoformat(),
        "--validated-at", NOW.isoformat(),
        "--activated-at", NOW.isoformat(),
    ]
    assert main(replay_args, application_factory=factory, settings=settings) == 0

    with pipeline_services.connection.cursor() as cursor:
        cursor.execute(
            "select status from ingest.source_release where source_release_id = %s",
            (release_id,),
        )
        assert cursor.fetchone() == ("sealed",)
        cursor.execute(
            "select count(*) from ingest.source_release_run "
            "where source_release_id = %s and run_id in (%s, %s)",
            (release_id, discovery_run_id, detail_run_id),
        )
        assert cursor.fetchone() == (2,)
