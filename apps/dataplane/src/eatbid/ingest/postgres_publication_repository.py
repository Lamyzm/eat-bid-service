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

REQUIRED_SCHEMES = (
    "eat:auction-location-sido",
    "eat:auction-location-sigungu",
    "eat:eligibility-area",
    "eat:organization",
)
SOURCE_CONTRACT = "SOURCE_CONTRACT"


class PublicationIntegrityError(RuntimeError):
    """Publication state conflicts with the requested validation operation."""


class PsycopgPublicationRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def add_replay_input(self, *, run_id: UUID, observation_id: int) -> None:
        _positive_id(observation_id, "observation_id")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                "select mode, status from ingest.run where run_id = %s for update",
                (run_id,),
            )
            run = cursor.fetchone()
            if run is None or run != ("replay", "running"):
                raise PublicationIntegrityError(
                    "replay input requires a running replay run"
                )
            cursor.execute(
                """
                insert into ingest.replay_input (run_id, observation_id)
                values (%s, %s)
                on conflict (run_id, observation_id) do nothing
                """,
                (run_id, observation_id),
            )

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
            mode, status, parser_version, expected_count, failure_category, ended_at = run
            if status not in {"running", "validated", "failed"}:
                raise PublicationIntegrityError("only a running run can be validated")

            request_counts, failed_requests = self._lock_requests(
                cursor, run_id, replay=mode == "replay"
            )
            observations = self._lock_observations(
                cursor, run_id, replay=mode == "replay"
            )
            if mode == "replay":
                request_counts = ((len(observations), len(observations)),)
            observation_ids = tuple(int(row[0]) for row in observations)
            attempts, outputs = self._lock_attempt_outputs(
                cursor,
                run_id=run_id,
                parser_version=str(parser_version),
                observation_ids=observation_ids,
            )
            matching_attempts = tuple(
                row for row in attempts if row[2] == parser_version
            )
            parser_mismatches = len(attempts) - len(matching_attempts)
            missing_attempts = len(observations) - len(matching_attempts)
            quarantined = sum(row[3] == "quarantined" for row in matching_attempts)
            schema_contract_violations = sum(
                not source_contract_validator(
                    source=str(row[4]),
                    endpoint=str(row[5]),
                    parser_version=str(row[2]),
                    schema_fingerprint=(str(row[6]) if row[6] is not None else None),
                )
                for row in matching_attempts
            )
            source_entities = [str(row[2]) for row in outputs]
            duplicate_source_entities = len(source_entities) - len(set(source_entities))
            missing_schemes = self._missing_schemes(cursor)
            member_ids = tuple(sorted(int(row[0]) for row in outputs))
            if status in {"validated", "failed"}:
                if status == "validated" and schema_contract_violations:
                    raise PublicationIntegrityError(
                        "validated publication no longer matches a reviewed schema contract"
                    )
                return self._load_existing(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    run_status=str(status),
                    run_expected_count=int(expected_count),
                    run_failure_category=(
                        str(failure_category)
                        if failure_category is not None
                        else None
                    ),
                    run_ended_at=ended_at,
                    current_normalized_count=len(outputs),
                    current_member_ids=member_ids,
                )
            report = completeness_validator(
                request_counts=request_counts,
                normalized=len(outputs),
                quarantined=quarantined + missing_attempts,
                duplicate_source_entities=duplicate_source_entities,
                missing_code_schemes=missing_schemes,
                schema_contract_violations=schema_contract_violations,
            )
            ledger_coherent = (
                failed_requests == 0
                and len(observations) == int(expected_count)
                and len(outputs) == len(observations)
                and len(matching_attempts) == len(observations)
                and parser_mismatches == 0
                and all(row[3] == parser_version for row in outputs)
            )
            if report.publishable and ledger_coherent:
                self._persist_validated(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    validated_at=validated_at,
                    expected_count=int(expected_count),
                    member_ids=member_ids,
                )
                return PublicationValidation(
                    publication_id=publication_id,
                    run_id=run_id,
                    status="validated",
                    expected_count=int(expected_count),
                    normalized_count=len(member_ids),
                    member_ids=member_ids,
                )

            self._persist_failed(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                failed_at=validated_at,
                expected_count=int(expected_count),
                normalized_count=len(outputs),
            )
            return PublicationValidation(
                publication_id=publication_id,
                run_id=run_id,
                status="failed",
                expected_count=int(expected_count),
                normalized_count=len(outputs),
                member_ids=(),
            )

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
    def _lock_observations(
        cursor: psycopg.Cursor[Any], run_id: UUID, *, replay: bool
    ) -> list[tuple[Any, ...]]:
        if replay:
            cursor.execute(
                """
                select o.observation_id
                from ingest.replay_input ri
                join ingest.raw_observation o on o.observation_id = ri.observation_id
                where ri.run_id = %s
                order by o.observation_id
                for update of ri, o
                """,
                (run_id,),
            )
        else:
            cursor.execute(
                """
                select observation_id
                from ingest.raw_observation where run_id = %s
                order by observation_id for update
                """,
                (run_id,),
            )
        return cursor.fetchall()

    @staticmethod
    def _lock_attempt_outputs(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        parser_version: str,
        observation_ids: tuple[int, ...],
    ) -> tuple[list[tuple[Any, ...]], list[tuple[Any, ...]]]:
        if not observation_ids:
            return [], []
        cursor.execute(
            """
            select a.normalization_attempt_id, a.observation_id,
                   a.parser_version, a.status, o.source, o.endpoint,
                   a.schema_fingerprint
            from ingest.normalization_attempt a
            join ingest.raw_observation o using (observation_id)
            where a.run_id = %s and a.observation_id = any(%s)
            order by a.normalization_attempt_id
            for update
            """,
            (run_id, list(observation_ids)),
        )
        attempts = cursor.fetchall()
        matching_attempt_ids = [
            int(row[0]) for row in attempts if row[2] == parser_version
        ]
        if not matching_attempt_ids:
            return attempts, []
        cursor.execute(
            """
            select n.normalized_record_id, a.observation_id, n.source_entity_id,
                   n.parser_version, n.record_type
            from ingest.normalization_attempt a
            join ingest.normalization_attempt_record ar
              on ar.normalization_attempt_id = a.normalization_attempt_id
            join ingest.normalized_record n
              on n.normalized_record_id = ar.normalized_record_id
            where a.normalization_attempt_id = any(%s)
            order by n.normalized_record_id
            for update of a, ar, n
            """,
            (matching_attempt_ids,),
        )
        return attempts, cursor.fetchall()

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
    ) -> None:
        cursor.execute(
            """
            insert into ingest.publication (
                publication_id, run_id, status, validated_at, activated_at,
                expected_count, normalized_count, published_count
            ) values (%s, %s, 'validated', %s, null, %s, %s, 0)
            """,
            (publication_id, run_id, validated_at, expected_count, len(member_ids)),
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
    ) -> None:
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
            (SOURCE_CONTRACT, failed_at, run_id),
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
                   expected_count, normalized_count, published_count
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
        if publication[3] is not None or int(publication[6]) != 0:
            raise PublicationIntegrityError(
                "Task 8 terminal publication activation metadata is invalid"
            )
        if run_status == "validated":
            if publication[2] is None or run_failure_category is not None or run_ended_at is not None:
                raise PublicationIntegrityError(
                    "validated run/publication metadata is inconsistent"
                )
        elif (
            publication[2] is not None
            or run_failure_category != SOURCE_CONTRACT
            or run_ended_at is None
        ):
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
        expected_member_ids = current_member_ids if run_status == "validated" else ()
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


def _positive_id(value: int, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{field} must be a positive integer")


def _aware(value: datetime, field: str) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
