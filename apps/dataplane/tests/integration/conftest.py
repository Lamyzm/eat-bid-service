from __future__ import annotations

import os
import subprocess
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from uuid import UUID, uuid4

import psycopg
import pytest
from docker.errors import NotFound
from testcontainers.community.postgres import PostgresContainer

from eatbid.core.postgres_repository import PsycopgCanonicalProjectionRepository
from eatbid.foundation import FoundationResult, FoundationServices, run_foundation_slice
from eatbid.ingest.postgres_normalization_repository import (
    PsycopgNormalizationRepository,
)
from eatbid.ingest.postgres_publication_repository import PsycopgPublicationRepository
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.postgres_repository import PsycopgObservationRepository
from eatbid.pipeline.replay import ReplayResult, ReplayServices, replay_observations
from eatbid.source.client import SourceResponse

from ..unit.fakes import MemoryRawObjectStore, StaticSourceClient

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]
FIXTURE_ROOT = Path(__file__).parents[1] / "fixtures"
FOUNDATION_CAPTURE_RUN_ID = UUID("13000000-0000-0000-0000-000000000001")
FOUNDATION_CAPTURE_PUBLICATION_ID = UUID("13000000-0000-0000-0000-000000000002")
FOUNDATION_REPLAY_RUN_ID = UUID("13000000-0000-0000-0000-000000000003")
FOUNDATION_REPLAY_PUBLICATION_ID = UUID("13000000-0000-0000-0000-000000000004")
FOUNDATION_BUILD_SHA = "d" * 64
FOUNDATION_PARSER_VERSION = "eat-v1"
FOUNDATION_STARTED_AT = datetime(2026, 8, 29, 4, 0, 0, tzinfo=UTC)
FOUNDATION_FETCHED_AT = datetime(2026, 8, 29, 4, 5, 0, tzinfo=UTC)
FOUNDATION_NORMALIZED_AT = datetime(2026, 8, 29, 4, 6, 0, tzinfo=UTC)
FOUNDATION_VALIDATED_AT = datetime(2026, 8, 29, 4, 7, 0, tzinfo=UTC)
FOUNDATION_ACTIVATED_AT = datetime(2026, 8, 29, 4, 8, 0, tzinfo=UTC)
FOUNDATION_REPLAY_STARTED_AT = datetime(2026, 8, 29, 4, 10, 0, tzinfo=UTC)
FOUNDATION_REPLAY_NORMALIZED_AT = datetime(2026, 8, 29, 4, 11, 0, tzinfo=UTC)
FOUNDATION_REPLAY_VALIDATED_AT = datetime(2026, 8, 29, 4, 12, 0, tzinfo=UTC)
FOUNDATION_REPLAY_ACTIVATED_AT = datetime(2026, 8, 29, 4, 13, 0, tzinfo=UTC)


@dataclass(frozen=True)
class MigratedDatabase:
    dsn: str
    container_name: str

    def connect(self) -> psycopg.Connection[tuple[object, ...]]:
        return psycopg.connect(self.dsn)


@dataclass(frozen=True)
class PipelineServices:
    connection: psycopg.Connection[tuple[object, ...]]
    repository: PsycopgObservationRepository
    normalization_repository: PsycopgNormalizationRepository
    publication_repository: PsycopgPublicationRepository
    replay_repository: PsycopgReplayRunRepository
    projection_repository: PsycopgCanonicalProjectionRepository
    store: MemoryRawObjectStore


class FoundationHarness(Protocol):
    def run_fixture(
        self, relative_path: str, *, expected_count: int
    ) -> FoundationResult: ...

    def replay(
        self, observation_ids: Sequence[int], *, parser_version: str
    ) -> ReplayResult: ...


@dataclass(frozen=True)
class _FoundationHarness:
    services: PipelineServices

    def run_fixture(
        self, relative_path: str, *, expected_count: int
    ) -> FoundationResult:
        fixture = (FIXTURE_ROOT / relative_path).resolve()
        if not fixture.is_relative_to(FIXTURE_ROOT.resolve()):
            raise ValueError("fixture path must remain below the fixture root")
        body = fixture.read_bytes()
        return run_foundation_slice(
            run_id=FOUNDATION_CAPTURE_RUN_ID,
            publication_id=FOUNDATION_CAPTURE_PUBLICATION_ID,
            mode="poll-open",
            build_sha=FOUNDATION_BUILD_SHA,
            parser_version=FOUNDATION_PARSER_VERSION,
            started_at=FOUNDATION_STARTED_AT,
            normalized_at=FOUNDATION_NORMALIZED_AT,
            validated_at=FOUNDATION_VALIDATED_AT,
            activated_at=FOUNDATION_ACTIVATED_AT,
            source="eat",
            endpoint="bid-detail",
            request_params={"ELCTRN_BID_ID": "task-13-bid-detail-one"},
            expected_count=expected_count,
            services=FoundationServices(
                ingest_repository=self.services.repository,
                normalization_repository=self.services.normalization_repository,
                publication_repository=self.services.publication_repository,
                projection_repository=self.services.projection_repository,
                raw_store=self.services.store,
                source_client=StaticSourceClient(
                    SourceResponse(200, body, FOUNDATION_FETCHED_AT)
                ),
            ),
        )

    def replay(
        self, observation_ids: Sequence[int], *, parser_version: str
    ) -> ReplayResult:
        return replay_observations(
            run_id=FOUNDATION_REPLAY_RUN_ID,
            publication_id=FOUNDATION_REPLAY_PUBLICATION_ID,
            observation_ids=tuple(observation_ids),
            build_sha=FOUNDATION_BUILD_SHA,
            parser_version=parser_version,
            started_at=FOUNDATION_REPLAY_STARTED_AT,
            normalized_at=FOUNDATION_REPLAY_NORMALIZED_AT,
            validated_at=FOUNDATION_REPLAY_VALIDATED_AT,
            activated_at=FOUNDATION_REPLAY_ACTIVATED_AT,
            services=ReplayServices(
                replay_repository=self.services.replay_repository,
                normalization_repository=self.services.normalization_repository,
                publication_repository=self.services.publication_repository,
                projection_repository=self.services.projection_repository,
                store=self.services.store,
            ),
        )


@pytest.fixture(scope="session")
def migrated_db() -> MigratedDatabase:
    container_name = f"eatbid-foundation-{uuid4().hex}"
    container = PostgresContainer(
        "postgres:16-alpine",
        username="eatbid",
        password="eatbid-task13",
        dbname="eatbid",
        driver=None,
    ).with_name(container_name)
    container.start()
    wrapped = container.get_wrapped_container()
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5432)
        dsn = f"postgresql://eatbid:eatbid-task13@{host}:{port}/eatbid"
        subprocess.run(
            ["pnpm", "--filter", "@eatbid/db", "build"],
            cwd=REPOSITORY_ROOT,
            check=True,
            shell=False,
            capture_output=True,
            text=True,
        )
        environment = os.environ.copy()
        environment["DATABASE_URL"] = dsn
        for _ in range(2):
            subprocess.run(
                ["node", "packages/db/dist/migrate.js"],
                cwd=REPOSITORY_ROOT,
                env=environment,
                check=True,
                shell=False,
                capture_output=True,
                text=True,
            )
        yield MigratedDatabase(dsn=dsn, container_name=container_name)
    finally:
        container.stop()
        with pytest.raises(NotFound):
            wrapped.reload()


@pytest.fixture
def pipeline_services(migrated_db: MigratedDatabase) -> PipelineServices:
    connection = migrated_db.connect()
    try:
        yield PipelineServices(
            connection=connection,
            repository=PsycopgObservationRepository(connection),
            normalization_repository=PsycopgNormalizationRepository(connection),
            publication_repository=PsycopgPublicationRepository(connection),
            replay_repository=PsycopgReplayRunRepository(connection),
            projection_repository=PsycopgCanonicalProjectionRepository(
                connection, migrated_db.connect
            ),
            store=MemoryRawObjectStore(
                now=lambda: datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)
            ),
        )
    finally:
        connection.close()


@pytest.fixture
def foundation(pipeline_services: PipelineServices) -> FoundationHarness:
    return _FoundationHarness(pipeline_services)
