"""모듈 책임: downstream command의 source release membership과 sealed 상태를 조회 검증한다."""

from __future__ import annotations

from datetime import datetime
from typing import Any, LiteralString, cast
from uuid import UUID

import psycopg
from psycopg import sql

from eatbid.ingest.models import PlannedRequestUnit
from eatbid.ingest.postgres_release_errors import require_terminal_scope
from eatbid.ingest.postgres_release_sealing import (
    require_sealed_release_locked,
    seal_release_locked,
)
from eatbid.ingest.release_models import SealedSourceRelease
from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseIsolationContractError,
    ReleaseManifestConflictError,
    ReleaseNotFoundError,
    ReleaseObservationMembershipError,
    ReleaseSealedError,
)


class PostgresReleaseGuardMixin:
    _connection: psycopg.Connection[Any]
    def require_observation_member(
        self, source_release_id: UUID, observation_id: int
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select 1 from ingest.source_release_observation
                where source_release_id = %s and observation_id = %s
                """,
                (source_release_id, observation_id),
            )
            if cursor.fetchone() is None:
                raise ReleaseObservationMembershipError(
                    "observation is not a member of the source release"
                )

    def require_sealed(self, source_release_id: UUID) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select status from ingest.source_release where source_release_id = %s",
                (source_release_id,),
            )
            row = cursor.fetchone()
            if row is None:
                raise ReleaseNotFoundError("source release does not exist")
            if row[0] != "sealed":
                raise ReleaseIncompleteError("source release is not sealed")
    def load_preplanned_detail_request(
        self, source_release_id: UUID, run_id: UUID, external_bid_id: str
    ) -> PlannedRequestUnit:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select u.request_unit_id, u.request_params, u.request_params_hash
                from ingest.source_release r
                join ingest.source_release_run sr using (source_release_id)
                join ingest.run run on run.run_id = sr.run_id
                join ingest.request_unit u on u.run_id = run.run_id
                where r.source_release_id = %s and r.status = 'planned'
                  and run.run_id = %s and run.status = 'running'
                  and u.source = 'eat' and u.endpoint = 'bid-detail'
                  and u.status in ('planned', 'captured')
                  and u.request_params ->> 'ELCTRN_BID_ID' = %s
                """,
                (source_release_id, run_id, external_bid_id),
            )
            rows = cursor.fetchall()
        if len(rows) != 1:
            raise ReleaseObservationMembershipError(
                "detail request is not an exact planned release member"
            )
        row = rows[0]
        return PlannedRequestUnit(
            int(row[0]), run_id, "eat", "bid-detail", dict(row[1]), str(row[2])
        )
    def require_processing_observation(
        self, source_release_id: UUID, run_id: UUID, observation_id: int
    ) -> None:
        self._require_exact_count(
            """
            select count(*) from ingest.source_release_run sr
            join ingest.source_release_observation so using (source_release_id)
            join ingest.raw_observation o on o.observation_id = so.observation_id
            where sr.source_release_id = %s and sr.run_id = %s
              and o.run_id = sr.run_id and o.observation_id = %s
              and o.endpoint = 'bid-detail'
            """,
            (source_release_id, run_id, observation_id),
            1,
            "observation and processing run are not exact release members",
        )

    def ensure_captured_observation(
        self, source_release_id: UUID, run_id: UUID, observation_id: int
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select r.source, o.source
                from ingest.source_release r
                join ingest.source_release_run sr using (source_release_id)
                join ingest.raw_observation o on o.run_id = sr.run_id
                where r.source_release_id = %s and r.status = 'planned'
                  and sr.run_id = %s and o.observation_id = %s
                  and o.endpoint = 'bid-detail'
                for update of r, o
                """,
                (source_release_id, run_id, observation_id),
            )
            row = cursor.fetchone()
            if row is None or row[0] != row[1]:
                raise ReleaseObservationMembershipError(
                    "captured detail observation is not an exact release member"
                )
            cursor.execute(
                """
                insert into ingest.source_release_observation (
                    source_release_id, observation_id
                ) values (%s, %s)
                on conflict (source_release_id, observation_id) do nothing
                """,
                (source_release_id, observation_id),
            )

    def require_observation_members(
        self, source_release_id: UUID, observation_ids: tuple[int, ...]
    ) -> None:
        if not observation_ids or len(set(observation_ids)) != len(observation_ids):
            raise ReleaseObservationMembershipError("replay corpus must be nonempty and unique")
        self._require_exact_count(
            """
            select count(*) from ingest.source_release_observation
            where source_release_id = %s and observation_id = any(%s)
            """,
            (source_release_id, list(observation_ids)),
            len(observation_ids),
            "replay observation corpus differs from the source release",
        )

    def require_publication_corpus(
        self, source_release_id: UUID, run_id: UUID, publication_id: UUID
    ) -> None:
        self._require_exact_count(
            """
            select count(*) from ingest.publication p
            join ingest.source_release_run sr on sr.run_id = p.run_id
            where p.publication_id = %s and p.run_id = %s
              and sr.source_release_id = %s and p.status = 'validated'
              and exists (
                select 1 from ingest.source_release release
                where release.source_release_id = sr.source_release_id
                  and release.status = 'sealed'
              )
              and not exists (
                select 1 from ingest.publication_record pr
                join ingest.normalized_record n using (normalized_record_id)
                where pr.publication_id = p.publication_id
                  and not exists (
                    select 1 from ingest.source_release_observation so
                    where so.source_release_id = sr.source_release_id
                      and so.observation_id = n.observation_id
                  )
              )
            """,
            (publication_id, run_id, source_release_id),
            1,
            "publication corpus differs from the source release",
        )

    def reconcile_and_seal(
        self, source_release_id: UUID, run_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease:
        if sealed_at.utcoffset() is None:
            raise ValueError("sealed_at must be timezone-aware")
        require_terminal_scope(self._connection)
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute("set transaction isolation level read committed")
                release_status = self._lock_release(cursor, source_release_id)
                self._lock_detail_corpus(cursor, source_release_id, run_id)
                row = self._detail_progress(cursor, source_release_id, run_id)
                if row is None or int(row[0]) != int(row[1]) or int(row[0]) != int(row[2]):
                    raise ReleaseIncompleteError(
                        "detail release corpus is not exact observed"
                    )
                expected, _, _, normalized, quarantined = map(int, row)
                if normalized + quarantined != expected:
                    raise ReleaseIncompleteError(
                        "detail release corpus is not terminal normalized"
                    )
                if release_status == "sealed":
                    return require_sealed_release_locked(cursor, source_release_id)
                cursor.execute(
                    """
                    update ingest.source_release_dataset
                    set observed_count = %s, normalized_count = %s,
                        quarantined_count = %s
                    where source_release_id = %s and dataset = 'ds_info'
                    """,
                    (expected, normalized, quarantined, source_release_id),
                )
                if cursor.rowcount != 1:
                    raise ReleaseNotFoundError("detail release dataset does not exist")
                return seal_release_locked(
                    cursor, source_release_id, sealed_at=sealed_at
                )
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

    @staticmethod
    def _lock_release(
        cursor: psycopg.Cursor[Any], source_release_id: UUID
    ) -> str:
        cursor.execute(
            "select status from ingest.source_release "
            "where source_release_id = %s for update",
            (source_release_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ReleaseNotFoundError("source release does not exist")
        if row[0] not in {"planned", "sealed"}:
            raise ReleaseSealedError("source release is not validatable")
        return str(row[0])

    @staticmethod
    def _lock_detail_corpus(
        cursor: psycopg.Cursor[Any], source_release_id: UUID, run_id: UUID
    ) -> None:
        cursor.execute(
            """
            select u.request_unit_id from ingest.source_release_run sr
            join ingest.request_unit u on u.run_id = sr.run_id
            where sr.source_release_id = %s and sr.run_id = %s
              and u.endpoint = 'bid-detail'
            order by u.request_unit_id for update of u
            """,
            (source_release_id, run_id),
        )
        cursor.fetchall()

    @staticmethod
    def _detail_progress(
        cursor: psycopg.Cursor[Any], source_release_id: UUID, run_id: UUID
    ) -> tuple[Any, ...] | None:
        cursor.execute(
            """
            select d.expected_count, count(distinct u.request_unit_id),
                   count(distinct so.observation_id),
                   count(distinct a.normalization_attempt_id)
                     filter (where a.status = 'normalized'),
                   count(distinct a.normalization_attempt_id)
                     filter (where a.status = 'quarantined')
            from ingest.source_release_dataset d
            join ingest.source_release_run sr using (source_release_id)
            join ingest.run r on r.run_id = sr.run_id
            left join ingest.request_unit u on u.run_id = r.run_id
              and u.endpoint = 'bid-detail' and u.status = 'captured'
            left join ingest.raw_observation o on o.request_unit_id = u.request_unit_id
              and o.run_id = r.run_id
            left join ingest.source_release_observation so
              on so.source_release_id = d.source_release_id
              and so.observation_id = o.observation_id
            left join ingest.normalization_attempt a on a.run_id = r.run_id
              and a.observation_id = so.observation_id
            where d.source_release_id = %s and d.endpoint = 'bid-detail'
              and d.dataset = 'ds_info' and r.run_id = %s
            group by d.expected_count
            """,
            (source_release_id, run_id),
        )
        return cursor.fetchone()

    def _require_exact_count(
        self, statement: str, params: tuple[Any, ...], expected: int, message: str
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(sql.SQL(cast(LiteralString, statement)), params)
            row = cursor.fetchone()
        if row is None or int(row[0]) != expected:
            raise ReleaseObservationMembershipError(message)
