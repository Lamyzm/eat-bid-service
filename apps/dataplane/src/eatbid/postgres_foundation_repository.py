from __future__ import annotations

import json
import re
from collections.abc import Iterator, Mapping
from contextlib import contextmanager
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus
from psycopg.types.json import Jsonb

from eatbid.foundation_repository import (
    FoundationCheckpoint,
    FoundationCheckpointRepository,
    FoundationIntegrityError,
    FoundationNormalizationCheckpoint,
    FoundationObservationCheckpoint,
    FoundationPublicationCheckpoint,
    FoundationPublishedEvidence,
    FoundationRequestCheckpoint,
)
from eatbid.ingest.models import CaptureRequest
from eatbid.ingest.repository import CaptureRunMode, request_params_sha256
from eatbid.postgres_topology import lock_auction_topology

_BUILD_SHA_PATTERN = re.compile(r"[0-9a-f]{64}")
_CAPTURE_MODES = {"poll-open", "daily-reconcile", "backfill"}


class PsycopgFoundationCheckpointRepository(FoundationCheckpointRepository):
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    @contextmanager
    def run_lock(self, *, run_id: UUID) -> Iterator[None]:
        if not isinstance(run_id, UUID):
            raise TypeError("run_id must be a UUID")
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise FoundationIntegrityError(
                "foundation lock requires an idle repository connection"
            )
        with self._connection.cursor() as cursor:
            cursor.execute(
                "select pg_advisory_lock(hashtextextended(%s, 13))", (str(run_id),)
            )
        self._connection.commit()
        try:
            yield
        finally:
            with self._connection.cursor() as cursor:
                cursor.execute(
                    "select pg_advisory_unlock(hashtextextended(%s, 13))",
                    (str(run_id),),
                )
                unlocked = cursor.fetchone()
            self._connection.commit()
            if unlocked != (True,):
                raise FoundationIntegrityError("foundation run lock was not owned")

    def start_or_load(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        mode: CaptureRunMode,
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        source: str,
        endpoint: str,
        request_params: Mapping[str, str],
        expected_count: int,
    ) -> FoundationCheckpoint:
        request = CaptureRequest(1, run_id, source, endpoint, request_params)
        if not isinstance(publication_id, UUID):
            raise TypeError("publication_id must be a UUID")
        if mode not in _CAPTURE_MODES:
            raise ValueError("foundation mode must be a capture mode")
        if _BUILD_SHA_PATTERN.fullmatch(build_sha) is None:
            raise ValueError("build_sha must be a lowercase SHA-256 digest")
        if not parser_version or parser_version.strip() != parser_version:
            raise ValueError("parser_version must be a nonempty trimmed string")
        if started_at.utcoffset() is None:
            raise ValueError("started_at must be timezone-aware")
        if (
            isinstance(expected_count, bool)
            or not isinstance(expected_count, int)
            or expected_count < 0
        ):
            raise ValueError("expected_count must be a nonnegative integer")
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise FoundationIntegrityError(
                "foundation start requires an idle repository connection"
            )

        params = dict(request.params)
        params_hash = request_params_sha256(params)
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                cursor.execute(
                    """
                insert into ingest.run (
                    run_id, mode, status, build_sha, parser_version, started_at,
                    expected_count, captured_count, published_count
                ) values (%s, %s, 'running', %s, %s, %s, %s, 0, 0)
                on conflict (run_id) do nothing
                returning run_id
                """,
                    (
                        run_id,
                        mode,
                        build_sha,
                        parser_version,
                        started_at,
                        expected_count,
                    ),
                )
                inserted = cursor.fetchone() is not None
                if inserted:
                    cursor.execute(
                        """
                    insert into ingest.publication (
                        publication_id, run_id, status, validated_at, activated_at,
                        expected_count, normalized_count, published_count
                    ) values (%s, %s, 'pending', null, null, %s, 0, 0)
                    """,
                        (publication_id, run_id, expected_count),
                    )
                    cursor.execute(
                        """
                    insert into ingest.request_unit (
                        run_id, source, endpoint, request_params,
                        request_params_hash, expected_count, observed_count, status
                    ) values (%s, %s, %s, %s, %s, %s, 0, 'planned')
                    """,
                        (
                            run_id,
                            source,
                            endpoint,
                            Jsonb(params),
                            params_hash,
                            expected_count,
                        ),
                    )
                checkpoint = self._load_locked(cursor, run_id=run_id)
                self._verify_requested_identity(
                    checkpoint,
                    publication_id=publication_id,
                    mode=mode,
                    build_sha=build_sha,
                    parser_version=parser_version,
                    started_at=started_at,
                    source=source,
                    endpoint=endpoint,
                    params=params,
                    params_hash=params_hash,
                    expected_count=expected_count,
                )
                return checkpoint
        except psycopg.errors.UniqueViolation as error:
            if error.diag.constraint_name != "publication_pkey":
                raise
            raise FoundationIntegrityError(
                "foundation publication identity is owned by another run"
            ) from error

    def load(self, *, run_id: UUID) -> FoundationCheckpoint:
        if not isinstance(run_id, UUID):
            raise TypeError("run_id must be a UUID")
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise FoundationIntegrityError(
                "foundation load requires an idle repository connection"
            )
        with self._connection.transaction(), self._connection.cursor() as cursor:
            return self._load_locked(cursor, run_id=run_id)

    @staticmethod
    def _load_locked(
        cursor: psycopg.Cursor[Any], *, run_id: UUID
    ) -> FoundationCheckpoint:
        cursor.execute(
            """
            select mode, status, build_sha, parser_version, started_at,
                   expected_count, captured_count, published_count,
                   failure_category, ended_at
            from ingest.run where run_id = %s for update
            """,
            (run_id,),
        )
        run = cursor.fetchone()
        if run is None:
            raise FoundationIntegrityError("foundation run does not exist")

        cursor.execute(
            """
            select request_unit_id, source, endpoint, request_params,
                   request_params_hash, expected_count, observed_count, status
            from ingest.request_unit where run_id = %s
            order by request_unit_id for update
            """,
            (run_id,),
        )
        request_rows = cursor.fetchall()
        if len(request_rows) != 1:
            raise FoundationIntegrityError(
                "foundation run must own exactly one request plan"
            )
        request_row = request_rows[0]
        request = FoundationRequestCheckpoint(
            request_unit_id=int(request_row[0]),
            run_id=run_id,
            source=str(request_row[1]),
            endpoint=str(request_row[2]),
            params=_string_mapping(request_row[3]),
            request_params_hash=str(request_row[4]),
            expected_count=int(request_row[5]),
            observed_count=int(request_row[6]),
            status=str(request_row[7]),
        )

        topology = lock_auction_topology(
            cursor,
            run_id=run_id,
            run_mode=str(run[0]),
            parser_version=str(run[3]),
        )
        if not topology.partial_coherent:
            raise FoundationIntegrityError(
                "foundation normalization topology is not partially coherent"
            )
        if len(topology.candidate_ids) > 1 or len(topology.attempts) > 1:
            raise FoundationIntegrityError(
                "foundation slice must contain at most one observation and attempt"
            )

        observation = None
        if topology.candidate_ids:
            cursor.execute(
                """
                select o.observation_id, o.run_id, o.request_unit_id, o.source,
                       o.endpoint, o.request_params, o.fetched_at, o.http_status,
                       o.content_sha256, b.object_key, b.byte_length
                from ingest.raw_observation o
                join ingest.raw_blob b using (content_sha256)
                where o.observation_id = %s
                """,
                (topology.candidate_ids[0],),
            )
            observation_row = cursor.fetchone()
            if observation_row is None:
                raise FoundationIntegrityError("foundation observation disappeared")
            observation = FoundationObservationCheckpoint(
                observation_id=int(observation_row[0]),
                run_id=observation_row[1],
                request_unit_id=int(observation_row[2]),
                source=str(observation_row[3]),
                endpoint=str(observation_row[4]),
                params=_string_mapping(observation_row[5]),
                fetched_at=observation_row[6],
                http_status=int(observation_row[7]),
                content_sha256=str(observation_row[8]),
                object_key=str(observation_row[9]),
                byte_length=int(observation_row[10]),
            )

        normalization = None
        if topology.attempts:
            attempt = topology.attempts[0]
            member = topology.members[0] if topology.members else None
            payload = None
            record_type = None
            source_entity_id = None
            normalized_record_id = None
            if member is not None:
                cursor.execute(
                    """
                    select normalized_payload from ingest.normalized_record
                    where normalized_record_id = %s
                    """,
                    (member.normalized_record_id,),
                )
                payload_row = cursor.fetchone()
                if payload_row is None:
                    raise FoundationIntegrityError(
                        "foundation normalized record disappeared"
                    )
                payload = _canonical_payload(payload_row[0])
                record_type = member.record_type
                source_entity_id = member.source_entity_id
                normalized_record_id = member.normalized_record_id
            cursor.execute(
                """
                select quarantine_reason from ingest.normalization_attempt
                where normalization_attempt_id = %s
                """,
                (attempt.attempt_id,),
            )
            reason_row = cursor.fetchone()
            normalization = FoundationNormalizationCheckpoint(
                normalization_attempt_id=attempt.attempt_id,
                observation_id=attempt.observation_id,
                parser_version=attempt.parser_version,
                status=attempt.status,
                normalized_record_id=normalized_record_id,
                record_type=record_type,
                source_entity_id=source_entity_id,
                canonical_payload=payload,
                schema_fingerprint=attempt.schema_fingerprint,
                quarantine_reason=(
                    str(reason_row[0])
                    if reason_row is not None and reason_row[0] is not None
                    else None
                ),
            )

        cursor.execute(
            """
            select publication_id, run_id, status, expected_count,
                   normalized_count, published_count, canonical_fingerprint,
                   projector_version
            from ingest.publication where run_id = %s for update
            """,
            (run_id,),
        )
        publication_rows = cursor.fetchall()
        if len(publication_rows) != 1:
            raise FoundationIntegrityError(
                "foundation run must own exactly one publication"
            )
        publication_row = publication_rows[0]
        cursor.execute(
            """
            select normalized_record_id from ingest.publication_record
            where publication_id = %s order by normalized_record_id for update
            """,
            (publication_row[0],),
        )
        member_ids = tuple(int(row[0]) for row in cursor.fetchall())
        publication = FoundationPublicationCheckpoint(
            publication_id=publication_row[0],
            run_id=publication_row[1],
            status=str(publication_row[2]),
            expected_count=int(publication_row[3]),
            normalized_count=int(publication_row[4]),
            published_count=int(publication_row[5]),
            member_ids=member_ids,
            canonical_fingerprint=(
                str(publication_row[6]) if publication_row[6] is not None else None
            ),
            projector_version=(
                str(publication_row[7]) if publication_row[7] is not None else None
            ),
        )

        evidence = None
        if str(run[1]) == "published":
            evidence = PsycopgFoundationCheckpointRepository._load_published_evidence(
                cursor,
                run_id=run_id,
                publication=publication,
                request=request,
                observation=observation,
            )

        checkpoint = FoundationCheckpoint(
            run_id=run_id,
            mode=str(run[0]),
            status=str(run[1]),
            build_sha=str(run[2]),
            parser_version=str(run[3]),
            started_at=run[4],
            expected_count=int(run[5]),
            captured_count=int(run[6]),
            published_count=int(run[7]),
            failure_category=(str(run[8]) if run[8] is not None else None),
            ended_at=run[9],
            request=request,
            observation=observation,
            normalization=normalization,
            publication=publication,
            evidence=evidence,
        )
        PsycopgFoundationCheckpointRepository._verify_persisted_checkpoint(
            checkpoint, topology_member_ids=topology.member_ids
        )
        return checkpoint

    @staticmethod
    def _load_published_evidence(
        cursor: psycopg.Cursor[Any],
        *,
        run_id: UUID,
        publication: FoundationPublicationCheckpoint,
        request: FoundationRequestCheckpoint,
        observation: FoundationObservationCheckpoint | None,
    ) -> FoundationPublishedEvidence:
        if observation is None or publication.canonical_fingerprint is None:
            raise FoundationIntegrityError(
                "published foundation evidence is incomplete"
            )
        cursor.execute(
            """
            select count(distinct o.content_sha256), count(distinct o.observation_id)
            from ingest.raw_observation o where o.run_id = %s
            """,
            (run_id,),
        )
        raw_counts = cursor.fetchone()
        if raw_counts is None:
            raise FoundationIntegrityError(
                "published raw evidence query returned no row"
            )
        raw_blob_count, observation_count = raw_counts
        cursor.execute(
            """
            select count(distinct ao.organization_id),
                   count(distinct ar.auction_attempt_id),
                   count(distinct ar.auction_revision_id)
            from ingest.publication_record pr
            join core.auction_revision ar using (normalized_record_id)
            join core.auction_organization ao using (auction_revision_id)
            where pr.publication_id = %s
            """,
            (publication.publication_id,),
        )
        core_counts = cursor.fetchone()
        if core_counts is None:
            raise FoundationIntegrityError(
                "published core evidence query returned no row"
            )
        organizations, attempts, revisions = core_counts
        return FoundationPublishedEvidence(
            capture_run_id=run_id,
            publication_id=publication.publication_id,
            request_unit_id=request.request_unit_id,
            observation_ids=(observation.observation_id,),
            raw_content_sha256=observation.content_sha256,
            raw_object_key=observation.object_key,
            raw_blob_count=int(raw_blob_count),
            observation_count=int(observation_count),
            publication_status=publication.status,
            organization_count=int(organizations),
            auction_attempt_count=int(attempts),
            auction_revision_count=int(revisions),
            canonical_fingerprint=publication.canonical_fingerprint,
        )

    @staticmethod
    def _verify_requested_identity(
        checkpoint: FoundationCheckpoint,
        *,
        publication_id: UUID,
        mode: CaptureRunMode,
        build_sha: str,
        parser_version: str,
        started_at: datetime,
        source: str,
        endpoint: str,
        params: dict[str, str],
        params_hash: str,
        expected_count: int,
    ) -> None:
        request = checkpoint.request
        if (
            checkpoint.mode != mode
            or checkpoint.build_sha != build_sha
            or checkpoint.parser_version != parser_version
            or checkpoint.started_at != started_at
            or checkpoint.expected_count != expected_count
            or checkpoint.publication.publication_id != publication_id
            or request.source != source
            or request.endpoint != endpoint
            or dict(request.params) != params
            or request.request_params_hash != params_hash
            or request.expected_count != expected_count
        ):
            raise FoundationIntegrityError(
                "foundation invocation identity differs from its frozen checkpoint"
            )

    @staticmethod
    def _verify_persisted_checkpoint(
        checkpoint: FoundationCheckpoint, *, topology_member_ids: tuple[int, ...]
    ) -> None:
        request = checkpoint.request
        publication = checkpoint.publication
        observation_count = int(checkpoint.observation is not None)
        if (
            checkpoint.mode not in _CAPTURE_MODES
            or checkpoint.status not in {"running", "validated", "published", "failed"}
            or request.run_id != checkpoint.run_id
            or request.expected_count != checkpoint.expected_count
            or request.observed_count != observation_count
            or checkpoint.captured_count != observation_count
            or publication.run_id != checkpoint.run_id
            or publication.expected_count != checkpoint.expected_count
        ):
            raise FoundationIntegrityError(
                "foundation checkpoint counts or identity drifted"
            )
        if checkpoint.observation is not None and (
            checkpoint.observation.run_id != checkpoint.run_id
            or checkpoint.observation.request_unit_id != request.request_unit_id
            or checkpoint.observation.source != request.source
            or checkpoint.observation.endpoint != request.endpoint
            or dict(checkpoint.observation.params) != dict(request.params)
        ):
            raise FoundationIntegrityError(
                "foundation observation differs from the frozen request"
            )
        normalized_member_ids = (
            ()
            if checkpoint.normalization is None
            or checkpoint.normalization.normalized_record_id is None
            else (checkpoint.normalization.normalized_record_id,)
        )
        if normalized_member_ids != topology_member_ids:
            raise FoundationIntegrityError(
                "foundation normalization member set drifted"
            )
        expected_publication_status = {
            "running": "pending",
            "validated": "validated",
            "published": "published",
            "failed": (
                "pending"
                if checkpoint.normalization is None
                and checkpoint.failure_category
                in {"SOURCE_CONTRACT", "SOURCE_THROTTLED"}
                else "failed"
            ),
        }[checkpoint.status]
        if publication.status != expected_publication_status:
            raise FoundationIntegrityError(
                "foundation run and publication status differ"
            )
        if checkpoint.status == "running":
            if (
                publication.normalized_count != 0
                or publication.published_count != 0
                or publication.member_ids
                or publication.canonical_fingerprint is not None
                or checkpoint.published_count != 0
                or checkpoint.failure_category is not None
                or checkpoint.ended_at is not None
                or checkpoint.evidence is not None
            ):
                raise FoundationIntegrityError(
                    "running foundation checkpoint has terminal metadata"
                )
        elif checkpoint.status == "validated":
            if (
                publication.normalized_count != 1
                or publication.published_count != 0
                or publication.member_ids != normalized_member_ids
                or publication.canonical_fingerprint is not None
                or checkpoint.published_count != 0
                or checkpoint.failure_category is not None
                or checkpoint.ended_at is not None
                or checkpoint.evidence is not None
            ):
                raise FoundationIntegrityError(
                    "validated foundation checkpoint is inconsistent"
                )
        elif checkpoint.status == "published":
            if (
                publication.normalized_count != 1
                or publication.published_count != 1
                or publication.member_ids != normalized_member_ids
                or publication.canonical_fingerprint is None
                or checkpoint.published_count != 1
                or checkpoint.failure_category is not None
                or checkpoint.ended_at is None
                or checkpoint.evidence is None
            ):
                raise FoundationIntegrityError(
                    "published foundation checkpoint is inconsistent"
                )
        elif checkpoint.failure_category is None or checkpoint.ended_at is None:
            raise FoundationIntegrityError(
                "failed foundation checkpoint lacks failure metadata"
            )


def _string_mapping(value: object) -> dict[str, str]:
    if not isinstance(value, Mapping) or any(
        not isinstance(key, str) or not isinstance(item, str)
        for key, item in value.items()
    ):
        raise FoundationIntegrityError("persisted request params must map strings")
    return dict(value)


def _canonical_payload(value: object) -> bytes:
    if not isinstance(value, Mapping):
        raise FoundationIntegrityError("normalized payload must be an object")
    return json.dumps(
        dict(value), ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
