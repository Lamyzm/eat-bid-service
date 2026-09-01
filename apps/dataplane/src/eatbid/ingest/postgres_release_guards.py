"""모듈 책임: downstream command의 source release membership과 sealed 상태를 조회 검증한다."""

from __future__ import annotations

from typing import Any, LiteralString, cast
from uuid import UUID

import psycopg
from psycopg import sql

from eatbid.ingest.models import PlannedRequestUnit
from eatbid.ingest.release_models import ReleaseDatasetProgress, SealedSourceRelease
from eatbid.ingest.release_repository import (
    ReleaseIncompleteError,
    ReleaseNotFoundError,
    ReleaseObservationMembershipError,
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
                  and u.status = 'planned'
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
        self, source_release_id: UUID, run_id: UUID, *, sealed_at: Any
    ) -> SealedSourceRelease:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select d.expected_count,
                       count(distinct u.request_unit_id),
                       count(distinct o.observation_id),
                       count(distinct a.normalization_attempt_id)
                         filter (where a.status = 'normalized'),
                       count(distinct a.normalization_attempt_id)
                         filter (where a.status = 'quarantined'),
                       (select count(*) from ingest.source_release_observation all_obs
                        where all_obs.source_release_id = d.source_release_id),
                       (select count(*) from ingest.source_release_observation member_obs
                        join ingest.raw_observation member_raw
                          on member_raw.observation_id = member_obs.observation_id
                        join ingest.source_release_run member_run
                          on member_run.source_release_id = member_obs.source_release_id
                         and member_run.run_id = member_raw.run_id
                        where member_obs.source_release_id = d.source_release_id)
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
                group by d.source_release_id, d.expected_count
                """,
                (source_release_id, run_id),
            )
            row = cursor.fetchone()
        if (
            row is None
            or int(row[0]) != int(row[1])
            or int(row[0]) != int(row[2])
            or int(row[5]) != int(row[6])
        ):
            raise ReleaseIncompleteError("detail release corpus is not exact observed")
        expected, _, _, normalized, quarantined = map(int, row[:5])
        if normalized + quarantined != expected:
            raise ReleaseIncompleteError("detail release corpus is not terminal normalized")
        repository: Any = self
        repository.record_dataset_progress(
            source_release_id,
            ReleaseDatasetProgress(
                dataset="ds_info",
                observed_count=expected,
                normalized_count=normalized,
                quarantined_count=quarantined,
            ),
        )
        return repository.seal_release(source_release_id, sealed_at=sealed_at)

    def _require_exact_count(
        self, statement: str, params: tuple[Any, ...], expected: int, message: str
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(sql.SQL(cast(LiteralString, statement)), params)
            row = cursor.fetchone()
        if row is None or int(row[0]) != expected:
            raise ReleaseObservationMembershipError(message)
