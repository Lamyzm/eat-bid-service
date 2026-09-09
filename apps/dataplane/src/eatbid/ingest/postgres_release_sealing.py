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
    FailedSourceRelease,
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


def require_sealed_release_locked(
    cursor: psycopg.Cursor[Any], source_release_id: UUID
) -> SealedSourceRelease:
    cursor.execute(
        """
        select source, release_name, status, as_of, manifest_sha256, sealed_at
        from ingest.source_release where source_release_id = %s for update
        """,
        (source_release_id,),
    )
    parent = cursor.fetchone()
    if parent is None:
        raise ReleaseNotFoundError("source release does not exist")
    if parent[2] != "sealed" or parent[4] is None or parent[5] is None:
        raise ReleaseIncompleteError("source release is not terminal sealed")
    datasets = load_release_datasets(cursor, source_release_id)
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
    if digest != parent[4]:
        raise ReleaseIncompleteError("sealed release manifest differs from its corpus")
    return SealedSourceRelease(
        source_release_id=source_release_id,
        source=str(parent[0]),
        as_of=parent[3],
        manifest_sha256=digest,
        sealed_at=parent[5],
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


def fail_release_transaction(
    connection: psycopg.Connection[Any],
    source_release_id: UUID,
    *,
    failure_category: str,
    failed_at: datetime,
) -> FailedSourceRelease:
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute("set transaction isolation level read committed")
        return fail_release_locked(
            cursor,
            source_release_id,
            failure_category=failure_category,
            failed_at=failed_at,
        )


def fail_release_locked(
    cursor: psycopg.Cursor[Any],
    source_release_id: UUID,
    *,
    failure_category: str,
    failed_at: datetime,
) -> FailedSourceRelease:
    """왜: 결론 없이 끝난 실행은 자동으로 닫지 않는다. planned는 같은 run으로 이어 갈 수 있는 상태라
    닫는 순간 재개가 막히므로, 운영자가 포기를 정한 그 한 transaction에서 release와 아직 열린 run을
    같은 category로 함께 닫는다(ADR 0025의 planned → failed 전이, EAT-122)."""
    cursor.execute(
        """
        select source, status, as_of, failure_category
        from ingest.source_release
        where source_release_id = %s
        for update
        """,
        (source_release_id,),
    )
    parent = cursor.fetchone()
    if parent is None:
        raise ReleaseNotFoundError("source release does not exist")
    source, status, as_of, recorded = str(parent[0]), str(parent[1]), parent[2], parent[3]
    if status == "failed":
        # 같은 category의 재호출은 정정이 아니라 멱등한 반복이다. 다른 category는 terminal 정정이라
        # 거부한다.
        if recorded == failure_category:
            return FailedSourceRelease(
                source_release_id=source_release_id,
                source=source,
                as_of=as_of,
                failure_category=failure_category,
                closed_run_ids=(),
            )
        raise ReleaseSealedError("failed source release cannot change its failure category")
    if status != "planned":
        raise ReleaseSealedError(f"{status} source release cannot be mutated")
    # 결론이 없는 run만 닫는다. validated·published run은 자기 결론이 있고 그것을 바꾸는 것은
    # lineage 정정이라 여기서 하지 않는다.
    cursor.execute(
        """
        select r.run_id
        from ingest.source_release_run sr
        join ingest.run r on r.run_id = sr.run_id
        where sr.source_release_id = %s and r.status in ('planned', 'running')
        order by r.run_id
        for update of r
        """,
        (source_release_id,),
    )
    open_runs = tuple(row[0] for row in cursor.fetchall())
    for run_id in open_runs:
        cursor.execute(
            """
            update ingest.run
            set status = 'failed', failure_category = %s, ended_at = %s
            where run_id = %s and status in ('planned', 'running')
            """,
            (failure_category, failed_at, run_id),
        )
        if cursor.rowcount != 1:
            raise ReleaseSealedError("release run became terminal during fail-release")
    cursor.execute(
        """
        update ingest.source_release
        set status = 'failed', failure_category = %s
        where source_release_id = %s and status = 'planned'
        """,
        (failure_category, source_release_id),
    )
    if cursor.rowcount != 1:
        raise ReleaseSealedError("source release became terminal")
    return FailedSourceRelease(
        source_release_id=source_release_id,
        source=source,
        as_of=as_of,
        failure_category=failure_category,
        closed_run_ids=open_runs,
    )
