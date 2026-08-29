from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import psycopg
import pytest
from docker.errors import NotFound
from testcontainers.community.postgres import PostgresContainer

from eatbid.ingest.postgres_repository import PsycopgObservationRepository

from ..unit.fakes import MemoryRawObjectStore

REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


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
    store: MemoryRawObjectStore


@pytest.fixture(scope="session")
def migrated_db() -> MigratedDatabase:
    container_name = f"eatbid-task7-{uuid4().hex}"
    container = PostgresContainer(
        "postgres:16-alpine",
        username="eatbid",
        password="eatbid-task7",
        dbname="eatbid",
        driver=None,
    ).with_name(container_name)
    container.start()
    wrapped = container.get_wrapped_container()
    try:
        host = container.get_container_host_ip()
        port = container.get_exposed_port(5432)
        dsn = f"postgresql://eatbid:eatbid-task7@{host}:{port}/eatbid"
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
            store=MemoryRawObjectStore(
                now=lambda: datetime(2026, 8, 29, 4, 5, 6, tzinfo=UTC)
            ),
        )
    finally:
        connection.close()
