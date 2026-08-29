from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.publication_repository import (
    CompletenessValidator,
    PublicationValidation,
    SourceContractValidator,
)
from eatbid.postgres_topology import lock_auction_topology

REQUIRED_SCHEMES = (
    "eat:auction-location-sido",
    "eat:auction-location-sigungu",
    "eat:eligibility-area",
    "eat:organization",
)
SOURCE_CONTRACT = "SOURCE_CONTRACT"
PROJECTION_CONTRACT = "PROJECTION_CONTRACT"
DATA_QUARANTINED = "DATA_QUARANTINED"


class PublicationIntegrityError(RuntimeError):
    """Publication state conflicts with the requested validation operation."""


class PsycopgPublicationRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def validate_run(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        validated_at: datetime,
        completeness_validator: CompletenessValidator,
        source_contract_validator: SourceContractValidator,
    ) -> PublicationValidation:
        _aware(validated_at, "validated_at")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select mode, status, parser_version, expected_count,
                       failure_category, ended_at
                from ingest.run where run_id = %s for update
                """,
                (run_id,),
            )
            run = cursor.fetchone()
            if run is None:
                raise PublicationIntegrityError("run does not exist")
            mode, status, parser_version, expected_count, failure_category, ended_at = (
                run
            )
            if status not in {"running", "validated", "failed"}:
                raise PublicationIntegrityError("only a running run can be validated")

            request_counts, failed_requests = self._lock_requests(
                cursor, run_id, replay=mode == "replay"
            )
            topology = lock_auction_topology(
                cursor,
                run_id=run_id,
                run_mode=str(mode),
                parser_version=str(parser_version),
            )
            if mode == "replay":
                request_counts = (
                    (len(topology.candidate_ids), len(topology.candidate_ids)),
                )
            schema_contract_violations = sum(
                not source_contract_validator(
                    source=attempt.source,
                    endpoint=attempt.endpoint,
                    parser_version=attempt.parser_version,
                    schema_fingerprint=attempt.schema_fingerprint,
                )
                for attempt in topology.current_attempts
            )
            source_entities = [member.source_entity_id for member in topology.members]
            duplicate_source_entities = len(source_entities) - len(set(source_entities))
            missing_schemes = self._missing_schemes(cursor)
            report = completeness_validator(
                request_counts=request_counts,
                normalized=len(topology.members),
                quarantined=(
                    topology.quarantined_current_attempts
                    + topology.missing_current_attempts
                ),
                duplicate_source_entities=duplicate_source_entities,
                missing_code_schemes=missing_schemes,
                schema_contract_violations=schema_contract_violations,
            )
            ledger_coherent = (
                failed_requests == 0
                and len(topology.candidate_ids) == int(expected_count)
                and topology.parser_mismatches == 0
                and topology.coherent
            )
            if status in {"validated", "failed"}:
                if status == "validated" and not (
                    report.publishable and ledger_coherent
                ):
                    raise PublicationIntegrityError(
                        "validated publication ledger is no longer complete"
                    )
                return self._load_existing(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    run_status=str(status),
                    run_expected_count=int(expected_count),
                    run_failure_category=(
                        str(failure_category) if failure_category is not None else None
                    ),
                    run_ended_at=ended_at,
                    current_normalized_count=len(topology.members),
                    current_member_ids=topology.member_ids,
                )
            if report.publishable and ledger_coherent:
                consume_pending = self._consume_pending(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    expected_count=int(expected_count),
                    required=mode == "replay",
                )
                self._persist_validated(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    validated_at=validated_at,
                    expected_count=int(expected_count),
                    member_ids=topology.member_ids,
                    consume_pending=consume_pending,
                )
                return PublicationValidation(
                    publication_id=publication_id,
                    run_id=run_id,
                    status="validated",
                    expected_count=int(expected_count),
                    normalized_count=len(topology.member_ids),
                    member_ids=topology.member_ids,
                )

            consume_pending = self._consume_pending(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                expected_count=int(expected_count),
                required=mode == "replay",
            )
            self._persist_failed(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                failed_at=validated_at,
                expected_count=int(expected_count),
                normalized_count=len(topology.members),
                failure_category=(
                    DATA_QUARANTINED
                    if topology.quarantined_current_attempts > 0
                    else SOURCE_CONTRACT
                ),
                consume_pending=consume_pending,
            )
            return PublicationValidation(
                publication_id=publication_id,
                run_id=run_id,
                status="failed",
                expected_count=int(expected_count),
                normalized_count=len(topology.members),
                member_ids=(),
            )

    @staticmethod
    def _consume_pending(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication_id: UUID,
        expected_count: int,
        required: bool,
    ) -> bool:
        cursor.execute(
            """
            select publication_id, status, validated_at, activated_at,
                   expected_count, normalized_count, published_count,
                   canonical_fingerprint, projector_version
            from ingest.publication where run_id = %s for update
            """,
            (run_id,),
        )
        pending = cursor.fetchone()
        if pending is None:
            if required:
                raise PublicationIntegrityError(
                    "replay requires its frozen pending publication"
                )
            return False
        expected_pending = (
            publication_id,
            "pending",
            None,
            None,
            expected_count,
            0,
            0,
            None,
            None,
        )
        if pending != expected_pending:
            raise PublicationIntegrityError(
                "pending publication identity or metadata differs"
            )
        return True

    @staticmethod
    def _lock_requests(
        cursor: psycopg.Cursor[Any], run_id: UUID, *, replay: bool
    ) -> tuple[tuple[tuple[int, int], ...], int]:
        cursor.execute(
            """
            select expected_count, observed_count, status
            from ingest.request_unit where run_id = %s
            order by request_unit_id for update
            """,
            (run_id,),
        )
        rows = cursor.fetchall()
        if replay:
            if rows:
                return (), len(rows)
            return (), 0
        return (
            tuple((int(row[0]), int(row[1])) for row in rows),
            sum(row[2] == "failed" for row in rows),
        )

    @staticmethod
    def _missing_schemes(cursor: psycopg.Cursor[Any]) -> tuple[str, ...]:
        cursor.execute(
            "select namespace from core.code_scheme where namespace = any(%s)",
            (list(REQUIRED_SCHEMES),),
        )
        present = {str(row[0]) for row in cursor.fetchall()}
        return tuple(scheme for scheme in REQUIRED_SCHEMES if scheme not in present)

    @staticmethod
    def _persist_validated(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication_id: UUID,
        validated_at: datetime,
        expected_count: int,
        member_ids: tuple[int, ...],
        consume_pending: bool,
    ) -> None:
        if consume_pending:
            _transition_pending_publication(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                expected_count=expected_count,
                status="validated",
                normalized_count=len(member_ids),
                validated_at=validated_at,
            )
        else:
            cursor.execute(
                """
                insert into ingest.publication (
                    publication_id, run_id, status, validated_at, activated_at,
                    expected_count, normalized_count, published_count
                ) values (%s, %s, 'validated', %s, null, %s, %s, 0)
                """,
                (
                    publication_id,
                    run_id,
                    validated_at,
                    expected_count,
                    len(member_ids),
                ),
            )
        cursor.executemany(
            """
            insert into ingest.publication_record (publication_id, normalized_record_id)
            values (%s, %s)
            """,
            [(publication_id, member_id) for member_id in member_ids],
        )
        cursor.execute(
            "update ingest.run set status = 'validated' where run_id = %s and status = 'running'",
            (run_id,),
        )
        if cursor.rowcount != 1:
            raise PublicationIntegrityError("run validation transition failed")

    @staticmethod
    def _persist_failed(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication_id: UUID,
        failed_at: datetime,
        expected_count: int,
        normalized_count: int,
        failure_category: str,
        consume_pending: bool,
    ) -> None:
        if consume_pending:
            _transition_pending_publication(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                expected_count=expected_count,
                status="failed",
                normalized_count=normalized_count,
                validated_at=None,
            )
        else:
            cursor.execute(
                """
                insert into ingest.publication (
                    publication_id, run_id, status, validated_at, activated_at,
                    expected_count, normalized_count, published_count
                ) values (%s, %s, 'failed', null, null, %s, %s, 0)
                """,
                (publication_id, run_id, expected_count, normalized_count),
            )
        cursor.execute(
            """
            update ingest.run
            set status = 'failed', failure_category = %s, ended_at = %s
            where run_id = %s and status = 'running'
            """,
            (failure_category, failed_at, run_id),
        )
        if cursor.rowcount != 1:
            raise PublicationIntegrityError("run failure transition failed")

    @staticmethod
    def _load_existing(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication_id: UUID,
        run_status: str,
        run_expected_count: int,
        run_failure_category: str | None,
        run_ended_at: datetime | None,
        current_normalized_count: int,
        current_member_ids: tuple[int, ...],
    ) -> PublicationValidation:
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
        if publication is None or publication[0] != publication_id:
            raise PublicationIntegrityError(
                "existing run publication identity does not match"
            )
        publication_status = str(publication[1])
        if publication_status != run_status:
            raise PublicationIntegrityError(
                "terminal run and publication status differ"
            )
        if (int(publication[4]), int(publication[5])) != (
            run_expected_count,
            current_normalized_count,
        ):
            raise PublicationIntegrityError(
                "terminal publication counts differ from current lineage"
            )
        if (
            publication[3] is not None
            or int(publication[6]) != 0
            or publication[7] is not None
            or publication[8] is not None
        ):
            raise PublicationIntegrityError(
                "Task 8 terminal publication activation metadata is invalid"
            )
        if run_status == "validated":
            if (
                publication[2] is None
                or run_failure_category is not None
                or run_ended_at is not None
            ):
                raise PublicationIntegrityError(
                    "validated run/publication metadata is inconsistent"
                )
        elif run_ended_at is None:
            raise PublicationIntegrityError("failed run must have an end timestamp")
        elif run_failure_category in {SOURCE_CONTRACT, DATA_QUARANTINED}:
            if publication[2] is not None:
                raise PublicationIntegrityError(
                    "source-contract failure cannot have a validation timestamp"
                )
        elif run_failure_category == PROJECTION_CONTRACT:
            if publication[2] is None:
                raise PublicationIntegrityError(
                    "projection-contract failure must preserve validation timestamp"
                )
        else:
            raise PublicationIntegrityError(
                "failed run/publication metadata is inconsistent"
            )
        cursor.execute(
            """
            select normalized_record_id from ingest.publication_record
            where publication_id = %s order by normalized_record_id
            for update
            """,
            (publication_id,),
        )
        member_ids = tuple(int(row[0]) for row in cursor.fetchall())
        expected_member_ids = (
            current_member_ids
            if run_status == "validated" or run_failure_category == PROJECTION_CONTRACT
            else ()
        )
        if member_ids != expected_member_ids:
            raise PublicationIntegrityError(
                "terminal publication member manifest differs from current lineage"
            )
        return PublicationValidation(
            publication_id=publication_id,
            run_id=run_id,
            status=publication_status,
            expected_count=int(publication[4]),
            normalized_count=int(publication[5]),
            member_ids=member_ids,
        )


def _transition_pending_publication(
    cursor: psycopg.Cursor[Any],
    *,
    run_id: UUID,
    publication_id: UUID,
    expected_count: int,
    status: str,
    normalized_count: int,
    validated_at: datetime | None,
) -> None:
    cursor.execute(
        """
        update ingest.publication
        set status = %s, validated_at = %s, normalized_count = %s
        where publication_id = %s and run_id = %s and status = 'pending'
          and expected_count = %s and normalized_count = 0
          and published_count = 0 and validated_at is null
          and activated_at is null and canonical_fingerprint is null
          and projector_version is null
        """,
        (
            status,
            validated_at,
            normalized_count,
            publication_id,
            run_id,
            expected_count,
        ),
    )
    if cursor.rowcount != 1:
        raise PublicationIntegrityError("pending publication transition failed")


def _aware(value: datetime, field: str) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
