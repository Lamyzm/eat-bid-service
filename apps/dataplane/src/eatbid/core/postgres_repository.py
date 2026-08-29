from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.core.models import (
    AuctionProjection,
    ProjectionFingerprintItem,
    ProjectResult,
    canonical_projection_fingerprint,
)
from eatbid.core.postgres_projection_writer import CanonicalProjectionWriter
from eatbid.core.repository import (
    FrozenPublicationMember,
    ProjectionContractError,
    ProjectionFactory,
)

PROJECTION_CONTRACT = "PROJECTION_CONTRACT"


@dataclass(frozen=True, slots=True)
class _PublicationState:
    run_id: UUID
    publication_status: str
    run_status: str
    build_sha: str
    parser_version: str
    expected_count: int
    normalized_count: int
    published_count: int
    validated_at: datetime | None
    activated_at: datetime | None
    canonical_fingerprint: str | None
    projector_version: str | None
    run_published_count: int
    failure_category: str | None
    ended_at: datetime | None


@dataclass(frozen=True, slots=True)
class _MemberEvidence:
    member: FrozenPublicationMember
    observed_at: datetime


class PsycopgCanonicalProjectionRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def project_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime,
        projection_factory: ProjectionFactory,
    ) -> ProjectResult:
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                return self._project_locked(
                    cursor,
                    publication_id=publication_id,
                    projector_version=projector_version,
                    activated_at=activated_at,
                    projection_factory=projection_factory,
                )
        except ProjectionContractError:
            self._mark_projection_failed(
                publication_id=publication_id, failed_at=activated_at
            )
            raise

    def _project_locked(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime,
        projection_factory: ProjectionFactory,
    ) -> ProjectResult:
        state = self._lock_publication(cursor, publication_id)
        if state.publication_status not in {"validated", "published"}:
            raise ProjectionContractError(
                "publication must be validated before projection"
            )
        if state.publication_status != state.run_status:
            raise ProjectionContractError("publication and run status differ")
        if projector_version != state.build_sha:
            raise ProjectionContractError("projector version differs from locked run")
        self._verify_state_metadata(state)

        evidence = self._lock_members(
            cursor,
            publication_id=publication_id,
            run_id=state.run_id,
            run_parser_version=state.parser_version,
            expected_count=state.expected_count,
            normalized_count=state.normalized_count,
        )
        projections = tuple(projection_factory(item.member) for item in evidence)
        fingerprint = _fingerprint(projections)
        allow_insert = state.publication_status == "validated"

        attempts_inserted = 0
        revisions_inserted = 0
        organizations_inserted = 0
        code_values_inserted = 0
        code_labels_inserted = 0
        relationships_inserted = 0
        writer = CanonicalProjectionWriter()
        for item, projection in zip(evidence, projections, strict=True):
            counts = writer.apply(
                cursor,
                projection=projection,
                observed_at=item.observed_at,
                allow_insert=allow_insert,
            )
            attempts_inserted += counts[0]
            revisions_inserted += counts[1]
            organizations_inserted += counts[2]
            code_values_inserted += counts[3]
            code_labels_inserted += counts[4]
            relationships_inserted += counts[5]

        if state.publication_status == "published":
            if state.canonical_fingerprint != fingerprint:
                raise ProjectionContractError(
                    "published canonical fingerprint differs from frozen members"
                )
            if state.projector_version != projector_version:
                raise ProjectionContractError("published projector version differs")
        else:
            cursor.execute(
                """
                update ingest.publication
                set status = 'published', activated_at = %s,
                    published_count = normalized_count,
                    canonical_fingerprint = %s, projector_version = %s
                where publication_id = %s and status = 'validated'
                """,
                (activated_at, fingerprint, projector_version, publication_id),
            )
            if cursor.rowcount != 1:
                raise ProjectionContractError("publication transition was not serialized")
            cursor.execute(
                """
                update ingest.run
                set status = 'published', ended_at = %s,
                    published_count = expected_count
                where run_id = %s and status = 'validated'
                """,
                (activated_at, state.run_id),
            )
            if cursor.rowcount != 1:
                raise ProjectionContractError("run publication transition failed")

        return ProjectResult(
            publication_id=publication_id,
            members_projected=len(projections),
            auction_attempts_inserted=attempts_inserted,
            auction_revisions_inserted=revisions_inserted,
            organizations_inserted=organizations_inserted,
            code_values_inserted=code_values_inserted,
            code_labels_inserted=code_labels_inserted,
            relationships_inserted=relationships_inserted,
            canonical_fingerprint=fingerprint,
        )

    @staticmethod
    def _lock_publication(
        cursor: psycopg.Cursor[Any], publication_id: UUID
    ) -> _PublicationState:
        cursor.execute(
            """
            select p.run_id, p.status, r.status, r.build_sha, r.parser_version,
                   p.expected_count, p.normalized_count, p.published_count,
                   p.validated_at, p.activated_at, p.canonical_fingerprint,
                   p.projector_version, r.published_count, r.failure_category,
                   r.ended_at
            from ingest.publication p
            join ingest.run r using (run_id)
            where p.publication_id = %s
            for update of p, r
            """,
            (publication_id,),
        )
        row = cursor.fetchone()
        if row is None:
            raise ProjectionContractError("publication does not exist")
        return _PublicationState(
            run_id=row[0],
            publication_status=str(row[1]),
            run_status=str(row[2]),
            build_sha=str(row[3]),
            parser_version=str(row[4]),
            expected_count=int(row[5]),
            normalized_count=int(row[6]),
            published_count=int(row[7]),
            validated_at=row[8],
            activated_at=row[9],
            canonical_fingerprint=(str(row[10]) if row[10] is not None else None),
            projector_version=(str(row[11]) if row[11] is not None else None),
            run_published_count=int(row[12]),
            failure_category=(str(row[13]) if row[13] is not None else None),
            ended_at=row[14],
        )

    @staticmethod
    def _verify_state_metadata(state: _PublicationState) -> None:
        if state.validated_at is None or state.expected_count != state.normalized_count:
            raise ProjectionContractError("publication validation metadata is incomplete")
        if state.publication_status == "validated":
            if any(
                value is not None
                for value in (
                    state.activated_at,
                    state.canonical_fingerprint,
                    state.projector_version,
                    state.failure_category,
                    state.ended_at,
                )
            ) or state.published_count != 0 or state.run_published_count != 0:
                raise ProjectionContractError("validated publication metadata is inconsistent")
        elif (
            state.activated_at is None
            or state.canonical_fingerprint is None
            or state.projector_version is None
            or state.ended_at is None
            or state.failure_category is not None
            or state.published_count != state.expected_count
            or state.run_published_count != state.expected_count
        ):
            raise ProjectionContractError("published publication metadata is inconsistent")

    @staticmethod
    def _lock_members(
        cursor: psycopg.Cursor[Any],
        *,
        publication_id: UUID,
        run_id: UUID,
        run_parser_version: str,
        expected_count: int,
        normalized_count: int,
    ) -> tuple[_MemberEvidence, ...]:
        cursor.execute(
            """
            select normalized_record_id
            from ingest.publication_record
            where publication_id = %s
            order by normalized_record_id
            for update
            """,
            (publication_id,),
        )
        manifest_ids = tuple(int(row[0]) for row in cursor.fetchall())
        if len(manifest_ids) != expected_count or len(manifest_ids) != normalized_count:
            raise ProjectionContractError("publication manifest cardinality differs")
        if not manifest_ids:
            return ()

        cursor.execute(
            """
            select n.normalized_record_id, n.observation_id, o.source, o.endpoint,
                   n.record_type, n.source_entity_id, n.normalized_payload,
                   n.parser_version, o.content_sha256, o.fetched_at,
                   a.observation_id, a.parser_version, a.status
            from ingest.publication_record pr
            join ingest.normalized_record n using (normalized_record_id)
            join ingest.raw_observation o using (observation_id)
            join ingest.normalization_attempt_record ar using (normalized_record_id)
            join ingest.normalization_attempt a using (normalization_attempt_id)
            where pr.publication_id = %s
              and a.run_id = %s
              and a.parser_version = %s
            order by n.normalized_record_id
            for update of pr, n, o, ar, a
            """,
            (publication_id, run_id, run_parser_version),
        )
        rows = cursor.fetchall()
        if tuple(int(row[0]) for row in rows) != manifest_ids:
            raise ProjectionContractError(
                "publication member lineage differs from frozen manifest"
            )
        result: list[_MemberEvidence] = []
        for row in rows:
            if int(row[1]) != int(row[10]) or str(row[12]) != "normalized":
                raise ProjectionContractError(
                    "publication member attempt lineage is inconsistent"
                )
            payload = row[6]
            if not isinstance(payload, dict):
                raise ProjectionContractError("normalized payload must be a JSON object")
            result.append(
                _MemberEvidence(
                    member=FrozenPublicationMember(
                        normalized_record_id=int(row[0]),
                        observation_id=int(row[1]),
                        source_system=str(row[2]),
                        endpoint=str(row[3]),
                        run_parser_version=run_parser_version,
                        record_type=str(row[4]),
                        source_entity_id=str(row[5]),
                        normalized_payload=payload,
                        parser_version=str(row[7]),
                        raw_content_sha256=str(row[8]),
                    ),
                    observed_at=row[9],
                )
            )
        return tuple(result)

    def _mark_projection_failed(
        self, *, publication_id: UUID, failed_at: datetime
    ) -> None:
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                """
                select p.run_id, p.status, r.status
                from ingest.publication p join ingest.run r using (run_id)
                where p.publication_id = %s for update of p, r
                """,
                (publication_id,),
            )
            row = cursor.fetchone()
            if row is None or (str(row[1]), str(row[2])) != (
                "validated",
                "validated",
            ):
                return
            cursor.execute(
                "update ingest.publication set status = 'failed' where publication_id = %s",
                (publication_id,),
            )
            cursor.execute(
                """
                update ingest.run
                set status = 'failed', failure_category = %s, ended_at = %s
                where run_id = %s and status = 'validated'
                """,
                (PROJECTION_CONTRACT, failed_at, row[0]),
            )
            if cursor.rowcount != 1:
                raise ProjectionContractError("projection failure transition failed")


def _fingerprint(projections: tuple[AuctionProjection, ...]) -> str:
    return canonical_projection_fingerprint(
        ProjectionFingerprintItem(
            source_system=projection.source_system,
            external_bid_id=projection.external_bid_id,
            raw_content_sha256=projection.raw_content_sha256,
            parser_version=projection.parser_version,
            normalized_payload_sha256=projection.normalized_payload_sha256,
        )
        for projection in projections
    )
