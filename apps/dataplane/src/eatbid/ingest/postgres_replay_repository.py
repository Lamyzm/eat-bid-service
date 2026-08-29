from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus

from eatbid.ingest.replay_repository import (
    ReplayRunState,
    validate_replay_start,
)
from eatbid.postgres_topology import LockedAuctionTopology, lock_auction_topology

DATA_QUARANTINED = "DATA_QUARANTINED"


class ReplayIntegrityError(RuntimeError):
    """A replay identity or its frozen manifest conflicts with persisted state."""


class ReplayTransactionScopeError(RuntimeError):
    """Replay start requires a repository-owned top-level transaction."""


class PsycopgReplayRunRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def start_or_load(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        observation_ids: tuple[int, ...],
        build_sha: str,
        parser_version: str,
        started_at: datetime,
    ) -> ReplayRunState:
        manifest = validate_replay_start(
            run_id=run_id,
            publication_id=publication_id,
            observation_ids=observation_ids,
            build_sha=build_sha,
            parser_version=parser_version,
            started_at=started_at,
        )
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise ReplayTransactionScopeError(
                "replay start requires an idle repository connection"
            )
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute(
                    """
                    insert into ingest.run (
                        run_id, mode, status, build_sha, parser_version, started_at,
                        expected_count, captured_count, published_count
                    ) values (%s, 'replay', 'running', %s, %s, %s, %s, 0, 0)
                    on conflict (run_id) do nothing
                    returning run_id
                    """,
                    (run_id, build_sha, parser_version, started_at, len(manifest)),
                )
                inserted = cursor.fetchone() is not None
                return self._load_locked(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    manifest=manifest,
                    build_sha=build_sha,
                    parser_version=parser_version,
                    started_at=started_at,
                    inserted=inserted,
                )
        except psycopg.errors.UniqueViolation as error:
            raise ReplayIntegrityError(
                "replay publication identity is already owned by another run"
            ) from error

    @staticmethod
    def _load_locked(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication_id: UUID,
        manifest: tuple[int, ...],
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        inserted: bool,
    ) -> ReplayRunState:
        cursor.execute(
            """
            select r.mode, r.status, r.build_sha, r.parser_version, r.started_at,
                   r.expected_count, r.captured_count, r.published_count,
                   r.failure_category, r.ended_at
            from ingest.run r where r.run_id = %s for update
            """,
            (run_id,),
        )
        run = cursor.fetchone()
        if run is None:
            raise ReplayIntegrityError("replay run disappeared")

        persisted_run_identity = (
            str(run[0]),
            str(run[2]),
            str(run[3]),
            run[4],
            int(run[5]),
            int(run[6]),
        )
        requested_run_identity = (
            "replay",
            build_sha,
            parser_version,
            started_at,
            len(manifest),
            0,
        )
        if persisted_run_identity != requested_run_identity:
            raise ReplayIntegrityError("existing replay identity metadata differs")

        if inserted:
            cursor.execute(
                """
                select observation_id from ingest.raw_observation
                where observation_id = any(%s)
                order by observation_id for update
                """,
                (list(manifest),),
            )
            existing_observations = tuple(int(row[0]) for row in cursor.fetchall())
            if existing_observations != manifest:
                raise ReplayIntegrityError(
                    "replay manifest contains an unknown observation"
                )
            cursor.executemany(
                """
                insert into ingest.replay_input (run_id, observation_id)
                values (%s, %s)
                """,
                [(run_id, observation_id) for observation_id in manifest],
            )

        topology = lock_auction_topology(
            cursor,
            run_id=run_id,
            run_mode=str(run[0]),
            parser_version=str(run[3]),
        )
        if topology.candidate_ids != manifest:
            raise ReplayIntegrityError("existing replay input manifest differs")

        if inserted:
            cursor.execute(
                """
                insert into ingest.publication (
                    publication_id, run_id, status, validated_at, activated_at,
                    expected_count, normalized_count, published_count,
                    canonical_fingerprint, projector_version
                ) values (%s, %s, 'pending', null, null, %s, 0, 0, null, null)
                """,
                (publication_id, run_id, len(manifest)),
            )

        cursor.execute(
            """
            select publication_id, status, validated_at, activated_at,
                   expected_count, normalized_count, published_count,
                   canonical_fingerprint, projector_version
            from ingest.publication where run_id = %s for update
            """,
            (run_id,),
        )
        publication = cursor.fetchone()
        if publication is None:
            raise ReplayIntegrityError("replay run is missing its pending publication")
        row = run + publication

        if (row[10], int(row[14])) != (publication_id, len(manifest)):
            raise ReplayIntegrityError("existing replay identity metadata differs")

        run_status = str(row[1])
        publication_status = str(row[11])
        expected_publication_status = {
            "running": "pending",
            "validated": "validated",
            "published": "published",
            "failed": "failed",
        }.get(run_status)
        if publication_status != expected_publication_status:
            raise ReplayIntegrityError("replay run/publication states differ")
        PsycopgReplayRunRepository._verify_state_metadata(
            row, run_status, topology=topology
        )

        failure_category = str(row[8]) if row[8] is not None else None
        PsycopgReplayRunRepository._verify_publication_members(
            cursor,
            publication_id=publication_id,
            run_status=run_status,
            failure_category=failure_category,
            topology=topology,
        )
        failure_observation_id: int | None = None
        failure_reason: str | None = None
        if run_status == "failed" and failure_category == DATA_QUARANTINED:
            cursor.execute(
                """
                select observation_id, quarantine_reason
                from ingest.normalization_attempt
                where run_id = %s and parser_version = %s and status = 'quarantined'
                order by observation_id, normalization_attempt_id
                for update
                """,
                (run_id, parser_version),
            )
            failures = cursor.fetchall()
            if not failures or any(member[0] not in manifest for member in failures):
                raise ReplayIntegrityError(
                    "quarantined replay failure has no matching attempt evidence"
                )
            failure_observation_id = int(failures[0][0])
            failure_reason = str(failures[0][1])

        return ReplayRunState(
            run_id=run_id,
            status=run_status,  # type: ignore[arg-type]
            parser_version=parser_version,
            build_sha=build_sha,
            observation_ids=manifest,
            publication_id=publication_id,
            failure_category=failure_category,
            failure_observation_id=failure_observation_id,
            failure_reason=failure_reason,
        )

    @staticmethod
    def _verify_state_metadata(
        row: tuple[Any, ...],
        run_status: str,
        *,
        topology: LockedAuctionTopology,
    ) -> None:
        run_published = int(row[7])
        failure_category = row[8]
        ended_at = row[9]
        validated_at = row[12]
        activated_at = row[13]
        expected_count = int(row[14])
        normalized_count = int(row[15])
        publication_published = int(row[16])
        fingerprint = row[17]
        projector_version = row[18]
        topology_must_be_frozen = run_status in {"validated", "published"} or (
            run_status == "failed" and failure_category == "PROJECTION_CONTRACT"
        )
        if topology_must_be_frozen and (
            not topology.coherent or normalized_count != len(topology.member_ids)
        ):
            raise ReplayIntegrityError(
                "replay topology differs from the frozen publication lineage"
            )
        if run_status == "running":
            coherent = (
                failure_category is None
                and ended_at is None
                and validated_at is None
                and activated_at is None
                and normalized_count == 0
                and run_published == 0
                and publication_published == 0
                and fingerprint is None
                and projector_version is None
            )
        elif run_status == "validated":
            coherent = (
                failure_category is None
                and ended_at is None
                and validated_at is not None
                and activated_at is None
                and normalized_count == expected_count
                and run_published == 0
                and publication_published == 0
                and fingerprint is None
                and projector_version is None
                and topology.coherent
                and normalized_count == len(topology.member_ids)
            )
        elif run_status == "published":
            coherent = (
                failure_category is None
                and ended_at is not None
                and validated_at is not None
                and activated_at is not None
                and normalized_count == expected_count
                and run_published == expected_count
                and publication_published == expected_count
                and fingerprint is not None
                and projector_version is not None
                and topology.coherent
                and normalized_count == len(topology.member_ids)
            )
        elif run_status == "failed":
            base_coherent = (
                failure_category is not None
                and ended_at is not None
                and activated_at is None
                and 0 <= normalized_count <= expected_count
                and run_published == 0
                and publication_published == 0
                and fingerprint is None
                and projector_version is None
            )
            if failure_category == "PROJECTION_CONTRACT":
                coherent = (
                    base_coherent
                    and validated_at is not None
                    and normalized_count == expected_count
                    and topology.coherent
                    and normalized_count == len(topology.member_ids)
                )
            elif failure_category in {"SOURCE_CONTRACT", DATA_QUARANTINED}:
                coherent = (
                    base_coherent
                    and validated_at is None
                    and normalized_count == len(topology.members)
                )
            else:
                coherent = False
        else:
            coherent = False
        if not coherent:
            raise ReplayIntegrityError("replay state metadata is inconsistent")

    @staticmethod
    def _verify_publication_members(
        cursor: psycopg.Cursor[Any],
        *,
        publication_id: UUID,
        run_status: str,
        failure_category: str | None,
        topology: LockedAuctionTopology,
    ) -> None:
        cursor.execute(
            """
            select normalized_record_id from ingest.publication_record
            where publication_id = %s order by normalized_record_id
            for update
            """,
            (publication_id,),
        )
        persisted_members = tuple(int(row[0]) for row in cursor.fetchall())
        if run_status in {"validated", "published"} or (
            run_status == "failed" and failure_category == "PROJECTION_CONTRACT"
        ):
            expected_members = topology.member_ids
        else:
            expected_members = ()
        if persisted_members != expected_members:
            raise ReplayIntegrityError(
                "replay publication member manifest differs from current topology"
            )
