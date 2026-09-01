"""모듈 책임: source release aggregate를 PostgreSQL transaction으로 원자적으로 봉인한다."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg import sql

from eatbid.ingest.postgres_release_errors import (
    MemberKind,
    raise_duplicate_member,
    raise_missing_member,
    raise_plan_conflict,
    require_terminal_scope,
)
from eatbid.ingest.postgres_release_guards import PostgresReleaseGuardMixin
from eatbid.ingest.postgres_release_mapping import (
    load_release_datasets,
    load_release_observations,
    lock_observation_source,
)
from eatbid.ingest.release_models import (
    ReleaseCompleteness,
    ReleaseDatasetPlan,
    ReleaseDatasetProgress,
    SealedSourceRelease,
    SourceReleasePlan,
)
from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseIsolationContractError,
    ReleaseManifestConflictError,
    ReleaseNotFoundError,
    ReleaseProgressError,
    ReleaseSealedError,
    ReleaseSourceMismatchError,
    release_manifest_sha256,
)


class PsycopgSourceReleaseRepository(PostgresReleaseGuardMixin):
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def plan_release(self, plan: SourceReleasePlan) -> None:
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into ingest.source_release (
                        source_release_id, source, release_name, status, as_of,
                        manifest_sha256, sealed_at, failure_category
                    ) values (%s, %s, %s, 'planned', %s, null, null, null)
                    """,
                    (
                        plan.source_release_id,
                        plan.source,
                        plan.release_name,
                        plan.as_of,
                    ),
                )
                cursor.executemany(
                    """
                    insert into ingest.source_release_dataset (
                        source_release_id, endpoint, dataset, record_type,
                        parser_version, schema_fingerprint, expected_count,
                        observed_count, normalized_count, quarantined_count, required
                    ) values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    [
                        (
                            plan.source_release_id,
                            dataset.endpoint,
                            dataset.dataset,
                            dataset.record_type,
                            dataset.parser_version,
                            dataset.schema_fingerprint,
                            dataset.expected_count,
                            dataset.observed_count,
                            dataset.normalized_count,
                            dataset.quarantined_count,
                            dataset.required,
                        )
                        for dataset in plan.datasets
                    ],
                )
        except psycopg.errors.UniqueViolation as error:
            raise_plan_conflict(error)

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None:
        self._attach_member(
            source_release_id,
            sql.SQL(
                "insert into ingest.source_release_run "
                "(source_release_id, run_id) values (%s, %s)"
            ),
            run_id,
            "run",
        )

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None:
        if (
            isinstance(observation_id, bool)
            or not isinstance(observation_id, int)
            or observation_id < 1
        ):
            raise ValueError("observation_id must be a positive integer")
        self._attach_member(
            source_release_id,
            sql.SQL(
                "insert into ingest.source_release_observation "
                "(source_release_id, observation_id) values (%s, %s)"
            ),
            observation_id,
            "observation",
        )

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            self._lock_planned(cursor, source_release_id)
            cursor.execute(
                """
                select expected_count, observed_count, normalized_count,
                       quarantined_count
                from ingest.source_release_dataset
                where source_release_id = %s and dataset = %s
                for update
                """,
                (source_release_id, progress.dataset),
            )
            row = cursor.fetchone()
            if row is None:
                raise ReleaseNotFoundError("source release dataset does not exist")
            expected, observed, normalized, quarantined = map(int, row)
            requested = (
                progress.observed_count,
                progress.normalized_count,
                progress.quarantined_count,
            )
            if progress.observed_count > expected:
                raise ReleaseProgressError("observed progress exceeds expected contract")
            if any(new < old for new, old in zip(requested, (observed, normalized, quarantined), strict=True)):
                raise ReleaseProgressError("dataset progress must be monotonic")
            cursor.execute(
                """
                update ingest.source_release_dataset
                set observed_count = %s, normalized_count = %s,
                    quarantined_count = %s
                where source_release_id = %s and dataset = %s
                """,
                (*requested, source_release_id, progress.dataset),
            )

    def completeness(
        self, source_release_id: UUID
    ) -> tuple[ReleaseCompleteness, ...]:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select 1 from ingest.source_release where source_release_id = %s",
                (source_release_id,),
            )
            if cursor.fetchone() is None:
                raise ReleaseNotFoundError("source release does not exist")
            return load_release_datasets(cursor, source_release_id)

    def seal_release(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease:
        if sealed_at.utcoffset() is None:
            raise ValueError("sealed_at must be timezone-aware")
        require_terminal_scope(self._connection)
        try:
            return self._seal_transaction(source_release_id, sealed_at=sealed_at)
        except psycopg.errors.UniqueViolation as error:
            raise ReleaseManifestConflictError(
                "canonical source release manifest already exists"
            ) from error
        except psycopg.Error as error:
            if error.sqlstate == "25000":
                raise ReleaseIsolationContractError(
                    "database rejected the terminal isolation contract",
                    sqlstate=error.sqlstate,
                ) from error
            raise

    def _seal_transaction(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute("set transaction isolation level read committed")
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
                raise ReleaseSealedError(
                    f"{parent[2]} source release cannot be mutated"
                )
            datasets = load_release_datasets(cursor, source_release_id)
            required = tuple(dataset for dataset in datasets if dataset.required)
            if not required or any(not dataset.is_complete for dataset in required):
                raise ReleaseIncompleteError(
                    "required source release datasets are not exact complete"
                )
            observations = load_release_observations(
                cursor,
                source_release_id,
                release_source=str(parent[0]),
            )
            plan = SourceReleasePlan(
                source_release_id=source_release_id,
                source=str(parent[0]),
                release_name=str(parent[1]),
                as_of=parent[3],
                datasets=tuple(
                    ReleaseDatasetPlan(**asdict(dataset))
                    for dataset in datasets
                ),
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

    def _attach_member(
        self,
        source_release_id: UUID,
        statement: sql.SQL,
        member_id: UUID | int,
        member_kind: MemberKind,
    ) -> None:
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                release_source = self._lock_planned(cursor, source_release_id)
                if member_kind == "observation":
                    if not isinstance(member_id, int):
                        raise TypeError("observation member_id must be an integer")
                    observation_source = lock_observation_source(
                        cursor, member_id
                    )
                    if (
                        observation_source is not None
                        and observation_source != release_source
                    ):
                        raise ReleaseSourceMismatchError(
                            release_source=release_source,
                            observation_source=observation_source,
                        )
                cursor.execute(statement, (source_release_id, member_id))
        except psycopg.errors.UniqueViolation as error:
            raise_duplicate_member(error, member_kind)
        except psycopg.errors.ForeignKeyViolation as error:
            raise_missing_member(error, member_kind, member_id)

    @staticmethod
    def _lock_planned(
        cursor: psycopg.Cursor[Any], source_release_id: UUID
    ) -> str:
        cursor.execute(
            "select source, status from ingest.source_release "
            "where source_release_id = %s for update",
            (source_release_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ReleaseNotFoundError("source release does not exist")
        if row[1] != "planned":
            raise ReleaseSealedError(f"{row[1]} source release cannot be mutated")
        return str(row[0])
