"""모듈 책임: source release의 terminal manifest 검증과 봉인을 한 transaction 안에서 수행한다."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.postgres_release_mapping import (
    load_release_datasets,
    load_release_observations,
)
from eatbid.ingest.release_models import (
    ReleaseDatasetPlan,
    SealedSourceRelease,
    SourceReleasePlan,
)
from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseNotFoundError,
    ReleaseSealedError,
    release_manifest_sha256,
)


def seal_release_transaction(
    connection: psycopg.Connection[Any],
    source_release_id: UUID,
    *,
    sealed_at: datetime,
) -> SealedSourceRelease:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("set transaction isolation level read committed")
        return seal_release_locked(cursor, source_release_id, sealed_at=sealed_at)


def seal_release_locked(
    cursor: psycopg.Cursor[Any],
    source_release_id: UUID,
    *,
    sealed_at: datetime,
) -> SealedSourceRelease:
    cursor.execute(
        """
        select source, release_name, status, as_of
        from ingest.source_release
        where source_release_id = %s
        for update
        """,
        (source_release_id,),
    )
    parent = cursor.fetchone()
    if parent is None:
        raise ReleaseNotFoundError("source release does not exist")
    if parent[2] != "planned":
        raise ReleaseSealedError(f"{parent[2]} source release cannot be mutated")
    datasets = load_release_datasets(cursor, source_release_id)
    required = tuple(dataset for dataset in datasets if dataset.required)
    if not required or any(not dataset.is_complete for dataset in required):
        raise ReleaseIncompleteError(
            "required source release datasets are not exact complete"
        )
    if any(dataset.endpoint == "bid-detail" for dataset in datasets):
        _require_all_observation_runs(cursor, source_release_id)
    observations = load_release_observations(
        cursor, source_release_id, release_source=str(parent[0])
    )
    plan = SourceReleasePlan(
        source_release_id=source_release_id,
        source=str(parent[0]),
        release_name=str(parent[1]),
        as_of=parent[3],
        datasets=tuple(ReleaseDatasetPlan(**asdict(dataset)) for dataset in datasets),
    )
    digest = release_manifest_sha256(plan, observations)
    cursor.execute(
        """
        update ingest.source_release
        set status = 'sealed', manifest_sha256 = %s, sealed_at = %s
        where source_release_id = %s and status = 'planned'
        """,
        (digest, sealed_at, source_release_id),
    )
    if cursor.rowcount != 1:
        raise ReleaseSealedError("source release became terminal")
    return SealedSourceRelease(
        source_release_id=source_release_id,
        source=str(parent[0]),
        as_of=parent[3],
        manifest_sha256=digest,
        sealed_at=sealed_at,
    )


def _require_all_observation_runs(
    cursor: psycopg.Cursor[Any], source_release_id: UUID
) -> None:
    cursor.execute(
        """
        select count(*)
        from ingest.source_release_observation member
        join ingest.raw_observation observation using (observation_id)
        where member.source_release_id = %s
          and not exists (
            select 1 from ingest.source_release_run release_run
            where release_run.source_release_id = member.source_release_id
              and release_run.run_id = observation.run_id
          )
        """,
        (source_release_id,),
    )
    row = cursor.fetchone()
    if row is None or int(row[0]) != 0:
        raise ReleaseIncompleteError(
            "release observation run is not an exact release member"
        )
