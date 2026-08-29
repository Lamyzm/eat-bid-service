from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.types.json import Jsonb

from eatbid.ingest.normalization_repository import (
    ObservationForNormalization,
    StoredNormalizedRecord,
)

_MAX_QUARANTINE_REASON = 500


class NormalizationIntegrityError(RuntimeError):
    """Persisted evidence or processing lineage conflicts with the operation."""


class NormalizationNondeterminismError(NormalizationIntegrityError):
    """The same observation/parser key produced a different normalized payload."""


class NormalizationAttemptConflictError(NormalizationIntegrityError):
    """A final normalization attempt cannot change state or membership."""


class PsycopgNormalizationRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def load_observation(
        self, *, processing_run_id: UUID, observation_id: int
    ) -> ObservationForNormalization:
        _positive_id(observation_id, "observation_id")
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select pr.run_id, pr.mode, pr.parser_version,
                       o.observation_id, o.run_id, o.source, o.endpoint,
                       o.request_params, u.request_params, o.content_sha256,
                       b.object_key,
                       exists (
                         select 1 from ingest.replay_input ri
                         where ri.run_id = pr.run_id
                           and ri.observation_id = o.observation_id
                       ) as replay_member,
                       pr.status
                from ingest.run pr
                cross join ingest.raw_observation o
                join ingest.request_unit u
                  on u.request_unit_id = o.request_unit_id and u.run_id = o.run_id
                join ingest.raw_blob b on b.content_sha256 = o.content_sha256
                where pr.run_id = %s and o.observation_id = %s
                """,
                (processing_run_id, observation_id),
            )
            row = cursor.fetchone()
        if row is None:
            raise NormalizationIntegrityError("processing run or observation does not exist")
        if row[12] != "running":
            raise NormalizationIntegrityError("normalization requires a running processing run")
        _verify_processing_membership(
            processing_run_id=row[0],
            processing_mode=str(row[1]),
            capture_run_id=row[4],
            replay_member=bool(row[11]),
        )
        return ObservationForNormalization(
            processing_run_id=row[0],
            processing_mode=str(row[1]),
            processing_parser_version=str(row[2]),
            observation_id=int(row[3]),
            capture_run_id=row[4],
            source=str(row[5]),
            endpoint=str(row[6]),
            request_params=_string_mapping(row[7]),
            planned_request_params=_string_mapping(row[8]),
            content_sha256=str(row[9]),
            object_key=str(row[10]),
        )

    def store_normalized(
        self,
        *,
        observation: ObservationForNormalization,
        record_type: str,
        source_entity_id: str,
        parser_version: str,
        canonical_payload: bytes,
        schema_fingerprint: str,
        attempted_at: datetime,
    ) -> StoredNormalizedRecord:
        _aware(attempted_at, "attempted_at")
        if not record_type or not source_entity_id or not parser_version:
            raise ValueError("normalized record identity fields are required")
        payload = _decode_canonical_payload(canonical_payload)
        with self._connection.transaction(), self._connection.cursor() as cursor:
            self._lock_and_verify(cursor, observation, parser_version)
            normalized_record_id = self._insert_or_verify_record(
                cursor,
                observation_id=observation.observation_id,
                record_type=record_type,
                source_entity_id=source_entity_id,
                parser_version=parser_version,
                payload=payload,
                attempted_at=attempted_at,
            )
            attempt_id = self._insert_or_verify_attempt(
                cursor,
                observation=observation,
                parser_version=parser_version,
                status="normalized",
                attempted_at=attempted_at,
                schema_fingerprint=schema_fingerprint,
                quarantine_reason=None,
            )
            cursor.execute(
                """
                insert into ingest.normalization_attempt_record (
                    normalization_attempt_id, normalized_record_id
                ) values (%s, %s)
                on conflict (normalization_attempt_id, normalized_record_id) do nothing
                """,
                (attempt_id, normalized_record_id),
            )
            cursor.execute(
                """
                select normalized_record_id
                from ingest.normalization_attempt_record
                where normalization_attempt_id = %s
                order by normalized_record_id
                """,
                (attempt_id,),
            )
            if cursor.fetchall() != [(normalized_record_id,)]:
                raise NormalizationAttemptConflictError(
                    "normalized attempt output membership differs"
                )
        return StoredNormalizedRecord(
            normalization_attempt_id=attempt_id,
            normalized_record_id=normalized_record_id,
            observation_id=observation.observation_id,
            run_id=observation.processing_run_id,
            record_type=record_type,
            source_entity_id=source_entity_id,
            parser_version=parser_version,
            canonical_payload=_canonical_json(payload),
            schema_fingerprint=schema_fingerprint,
        )

    def quarantine(
        self,
        *,
        observation: ObservationForNormalization,
        reason: str,
        schema_fingerprint: str | None,
        attempted_at: datetime,
    ) -> None:
        _aware(attempted_at, "attempted_at")
        bounded_reason = reason[:_MAX_QUARANTINE_REASON] or "invalid source payload"
        with self._connection.transaction(), self._connection.cursor() as cursor:
            self._lock_and_verify(
                cursor, observation, observation.processing_parser_version
            )
            attempt_id = self._insert_or_verify_attempt(
                cursor,
                observation=observation,
                parser_version=observation.processing_parser_version,
                status="quarantined",
                attempted_at=attempted_at,
                schema_fingerprint=schema_fingerprint,
                quarantine_reason=bounded_reason,
            )
            cursor.execute(
                """
                select count(*) from ingest.normalization_attempt_record
                where normalization_attempt_id = %s
                """,
                (attempt_id,),
            )
            if cursor.fetchone() != (0,):
                raise NormalizationAttemptConflictError(
                    "quarantined attempt cannot have normalized records"
                )

    @staticmethod
    def _insert_or_verify_record(
        cursor: psycopg.Cursor[Any],
        *,
        observation_id: int,
        record_type: str,
        source_entity_id: str,
        parser_version: str,
        payload: dict[str, object],
        attempted_at: datetime,
    ) -> int:
        cursor.execute(
            """
            insert into ingest.normalized_record (
                observation_id, record_type, source_entity_id,
                normalized_payload, parser_version, normalized_at
            ) values (%s, %s, %s, %s, %s, %s)
            on conflict (
                observation_id, record_type, source_entity_id, parser_version
            ) do nothing
            returning normalized_record_id
            """,
            (
                observation_id,
                record_type,
                source_entity_id,
                Jsonb(payload),
                parser_version,
                attempted_at,
            ),
        )
        inserted = cursor.fetchone()
        if inserted is not None:
            return int(inserted[0])
        cursor.execute(
            """
            select normalized_record_id, normalized_payload
            from ingest.normalized_record
            where observation_id = %s and record_type = %s
              and source_entity_id = %s and parser_version = %s
            for update
            """,
            (observation_id, record_type, source_entity_id, parser_version),
        )
        existing = cursor.fetchone()
        if existing is None or existing[1] != payload:
            raise NormalizationNondeterminismError(
                "existing normalized payload differs for the same key"
            )
        return int(existing[0])

    @staticmethod
    def _insert_or_verify_attempt(
        cursor: psycopg.Cursor[Any],
        *,
        observation: ObservationForNormalization,
        parser_version: str,
        status: str,
        attempted_at: datetime,
        schema_fingerprint: str | None,
        quarantine_reason: str | None,
    ) -> int:
        cursor.execute(
            """
            insert into ingest.normalization_attempt (
                run_id, observation_id, parser_version, status, attempted_at,
                schema_fingerprint, quarantine_reason
            ) values (%s, %s, %s, %s, %s, %s, %s)
            on conflict (run_id, observation_id, parser_version) do nothing
            returning normalization_attempt_id
            """,
            (
                observation.processing_run_id,
                observation.observation_id,
                parser_version,
                status,
                attempted_at,
                schema_fingerprint,
                quarantine_reason,
            ),
        )
        inserted = cursor.fetchone()
        if inserted is not None:
            return int(inserted[0])
        cursor.execute(
            """
            select normalization_attempt_id, status, attempted_at,
                   schema_fingerprint, quarantine_reason
            from ingest.normalization_attempt
            where run_id = %s and observation_id = %s and parser_version = %s
            for update
            """,
            (
                observation.processing_run_id,
                observation.observation_id,
                parser_version,
            ),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise NormalizationAttemptConflictError(
                "final normalization attempt disappeared"
            )
        expected = (status, schema_fingerprint, quarantine_reason)
        persisted = (existing[1], existing[3], existing[4])
        if persisted != expected:
            raise NormalizationAttemptConflictError(
                "final normalization attempt metadata differs"
            )
        return int(existing[0])

    @staticmethod
    def _lock_and_verify(
        cursor: psycopg.Cursor[Any],
        observation: ObservationForNormalization,
        parser_version: str,
    ) -> None:
        cursor.execute(
            """
            select pr.mode, pr.status, pr.parser_version,
                   o.run_id, o.source, o.endpoint, o.request_params,
                   u.request_params, o.content_sha256, b.object_key,
                   exists (
                     select 1 from ingest.replay_input ri
                     where ri.run_id = pr.run_id
                       and ri.observation_id = o.observation_id
                   ) as replay_member
            from ingest.run pr
            cross join ingest.raw_observation o
            join ingest.request_unit u
              on u.request_unit_id = o.request_unit_id and u.run_id = o.run_id
            join ingest.raw_blob b on b.content_sha256 = o.content_sha256
            where pr.run_id = %s and o.observation_id = %s
            for update of pr, o, u, b
            """,
            (observation.processing_run_id, observation.observation_id),
        )
        row = cursor.fetchone()
        if row is None:
            raise NormalizationIntegrityError("normalization input disappeared")
        _verify_processing_membership(
            processing_run_id=observation.processing_run_id,
            processing_mode=str(row[0]),
            capture_run_id=row[3],
            replay_member=bool(row[10]),
        )
        expected = (
            observation.processing_mode,
            "running",
            observation.processing_parser_version,
            observation.capture_run_id,
            observation.source,
            observation.endpoint,
            dict(observation.request_params),
            dict(observation.planned_request_params),
            observation.content_sha256,
            observation.object_key,
        )
        if row[:10] != expected:
            raise NormalizationIntegrityError(
                "locked input no longer matches normalization candidate"
            )
        if parser_version != observation.processing_parser_version:
            raise NormalizationIntegrityError(
                "parser version differs from the processing run"
            )


def _verify_processing_membership(
    *,
    processing_run_id: UUID,
    processing_mode: str,
    capture_run_id: UUID,
    replay_member: bool,
) -> None:
    if processing_mode == "replay":
        if not replay_member:
            raise NormalizationIntegrityError(
                "observation is not a member of the replay input manifest"
            )
    elif processing_run_id != capture_run_id:
        raise NormalizationIntegrityError(
            "capture/backfill processing must use its own observations"
        )


def _decode_canonical_payload(value: bytes) -> dict[str, object]:
    try:
        decoded = json.loads(value)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("canonical payload must be UTF-8 JSON") from error
    if not isinstance(decoded, dict):
        raise TypeError("canonical payload must be a JSON object")
    if _canonical_json(decoded) != value:
        raise ValueError("normalized payload is not canonical JSON")
    return decoded


def _canonical_json(value: Mapping[str, object]) -> bytes:
    return json.dumps(
        dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _string_mapping(value: object) -> Mapping[str, str]:
    if not isinstance(value, dict) or any(
        not isinstance(key, str) or not isinstance(item, str)
        for key, item in value.items()
    ):
        raise NormalizationIntegrityError("request parameters are not string mappings")
    return value.copy()


def _positive_id(value: int, field: str) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise ValueError(f"{field} must be a positive integer")


def _aware(value: datetime, field: str) -> None:
    if value.utcoffset() is None:
        raise ValueError(f"{field} must be timezone-aware")
