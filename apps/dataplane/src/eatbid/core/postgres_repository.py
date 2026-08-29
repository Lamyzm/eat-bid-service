from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus

from eatbid.core.models import (
    AuctionProjection,
    ProjectionFingerprintItem,
    ProjectResult,
    canonical_projection_fingerprint,
)
from eatbid.core.postgres_projection_writer import (
    CanonicalProjectionWriter,
    validate_projection,
)
from eatbid.core.repository import (
    FrozenPublicationMember,
    ProjectionContractError,
    ProjectionFactory,
    ProjectionTransactionScopeError,
    PublishedProjectionEvidence,
)
from eatbid.postgres_topology import LockedAuctionTopology, lock_auction_topology

PROJECTION_CONTRACT = "PROJECTION_CONTRACT"


@dataclass(frozen=True, slots=True)
class _PublicationState:
    run_id: UUID
    run_mode: str
    started_at: datetime
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
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        failure_connection_factory: Callable[[], psycopg.Connection[Any]],
    ) -> None:
        self._connection = connection
        self._failure_connection_factory = failure_connection_factory

    def project_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime,
        projection_factory: ProjectionFactory,
    ) -> ProjectResult:
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise ProjectionTransactionScopeError(
                "projection requires an idle transaction owned by the repository"
            )
        try:
            with self._connection.transaction(), self._connection.cursor() as cursor:
                return self._project_locked(
                    cursor,
                    publication_id=publication_id,
                    projector_version=projector_version,
                    activated_at=activated_at,
                    projection_factory=projection_factory,
                    require_published=False,
                )
        except ProjectionContractError:
            self._mark_projection_failed(
                publication_id=publication_id, failed_at=activated_at
            )
            raise

    def verify_published_publication(
        self,
        *,
        publication_id: UUID,
        projector_version: str,
        projection_factory: ProjectionFactory,
    ) -> PublishedProjectionEvidence:
        if self._connection.info.transaction_status != TransactionStatus.IDLE:
            raise ProjectionTransactionScopeError(
                "projection verification requires an idle repository transaction"
            )
        with self._connection.transaction(), self._connection.cursor() as cursor:
            result = self._project_locked(
                cursor,
                publication_id=publication_id,
                projector_version=projector_version,
                activated_at=None,
                projection_factory=projection_factory,
                require_published=True,
            )
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
                (publication_id,),
            )
            counts = cursor.fetchone()
            if counts is None:
                raise ProjectionContractError(
                    "published canonical evidence query returned no row"
                )
            return PublishedProjectionEvidence(
                publication_id=publication_id,
                members_projected=result.members_projected,
                organization_count=int(counts[0]),
                auction_attempt_count=int(counts[1]),
                auction_revision_count=int(counts[2]),
                canonical_fingerprint=result.canonical_fingerprint,
            )

    def _project_locked(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        publication_id: UUID,
        projector_version: str,
        activated_at: datetime | None,
        projection_factory: ProjectionFactory,
        require_published: bool,
    ) -> ProjectResult:
        state, topology = self._lock_projection_inputs(cursor, publication_id)
        if state.publication_status not in {"validated", "published"}:
            raise ProjectionContractError(
                "publication must be validated before projection"
            )
        if require_published and state.publication_status != "published":
            raise ProjectionContractError("publication is not published")
        if state.publication_status != state.run_status:
            raise ProjectionContractError("publication and run status differ")
        if projector_version != state.build_sha:
            raise ProjectionContractError("projector version differs from locked run")
        self._verify_state_metadata(state)
        effective_activated_at = activated_at or state.activated_at
        if (
            state.validated_at is None
            or effective_activated_at is None
            or effective_activated_at < max(state.validated_at, state.started_at)
        ):
            raise ProjectionContractError(
                "publication activation chronology is invalid"
            )

        evidence = self._lock_members(
            cursor,
            publication_id=publication_id,
            topology=topology,
            run_parser_version=state.parser_version,
            expected_count=state.expected_count,
            normalized_count=state.normalized_count,
        )
        projections = tuple(projection_factory(item.member) for item in evidence)
        for item, projection in zip(evidence, projections, strict=True):
            validate_projection(projection)
            self._verify_factory_output(item.member, projection)
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
                (
                    effective_activated_at,
                    fingerprint,
                    projector_version,
                    publication_id,
                ),
            )
            if cursor.rowcount != 1:
                raise ProjectionContractError(
                    "publication transition was not serialized"
                )
            cursor.execute(
                """
                update ingest.run
                set status = 'published', ended_at = %s,
                    published_count = expected_count
                where run_id = %s and status = 'validated'
                """,
                (effective_activated_at, state.run_id),
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
    def _lock_projection_inputs(
        cursor: psycopg.Cursor[Any], publication_id: UUID
    ) -> tuple[_PublicationState, LockedAuctionTopology]:
        cursor.execute(
            "select run_id from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        owner = cursor.fetchone()
        if owner is None:
            raise ProjectionContractError("publication does not exist")
        run_id = owner[0]
        cursor.execute(
            """
            select mode, started_at, status, build_sha, parser_version,
                   expected_count, published_count, failure_category, ended_at
            from ingest.run where run_id = %s for update
            """,
            (run_id,),
        )
        run = cursor.fetchone()
        if run is None:
            raise ProjectionContractError("publication owner does not exist")
        topology = lock_auction_topology(
            cursor,
            run_id=run_id,
            run_mode=str(run[0]),
            parser_version=str(run[4]),
        )
        cursor.execute(
            """
            select run_id, status, expected_count, normalized_count,
                   published_count, validated_at, activated_at,
                   canonical_fingerprint, projector_version
            from ingest.publication where publication_id = %s for update
            """,
            (publication_id,),
        )
        publication = cursor.fetchone()
        if publication is None or publication[0] != run_id:
            raise ProjectionContractError("publication does not exist")
        if int(publication[2]) != int(run[5]):
            raise ProjectionContractError(
                "publication expected count differs from locked run"
            )
        return (
            _PublicationState(
                run_id=run_id,
                run_mode=str(run[0]),
                started_at=run[1],
                publication_status=str(publication[1]),
                run_status=str(run[2]),
                build_sha=str(run[3]),
                parser_version=str(run[4]),
                expected_count=int(publication[2]),
                normalized_count=int(publication[3]),
                published_count=int(publication[4]),
                validated_at=publication[5],
                activated_at=publication[6],
                canonical_fingerprint=(
                    str(publication[7]) if publication[7] is not None else None
                ),
                projector_version=(
                    str(publication[8]) if publication[8] is not None else None
                ),
                run_published_count=int(run[6]),
                failure_category=(str(run[7]) if run[7] is not None else None),
                ended_at=run[8],
            ),
            topology,
        )

    @staticmethod
    def _verify_state_metadata(state: _PublicationState) -> None:
        if state.validated_at is None or state.expected_count != state.normalized_count:
            raise ProjectionContractError(
                "publication validation metadata is incomplete"
            )
        if state.publication_status == "validated":
            if (
                any(
                    value is not None
                    for value in (
                        state.activated_at,
                        state.canonical_fingerprint,
                        state.projector_version,
                        state.failure_category,
                        state.ended_at,
                    )
                )
                or state.published_count != 0
                or state.run_published_count != 0
            ):
                raise ProjectionContractError(
                    "validated publication metadata is inconsistent"
                )
        elif (
            state.activated_at is None
            or state.canonical_fingerprint is None
            or state.projector_version is None
            or state.ended_at is None
            or state.failure_category is not None
            or state.published_count != state.expected_count
            or state.run_published_count != state.expected_count
        ):
            raise ProjectionContractError(
                "published publication metadata is inconsistent"
            )

    @staticmethod
    def _lock_members(
        cursor: psycopg.Cursor[Any],
        *,
        publication_id: UUID,
        topology: LockedAuctionTopology,
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
        if (
            len(topology.candidate_ids) != expected_count
            or not topology.coherent
            or topology.member_ids != manifest_ids
        ):
            raise ProjectionContractError("publication candidate topology differs")
        if not topology.candidate_ids:
            return ()

        cursor.execute(
            """
            select n.normalized_record_id, n.observation_id, o.source, o.endpoint,
                   n.record_type, n.source_entity_id, n.normalized_payload,
                   n.parser_version, o.content_sha256, o.fetched_at
            from ingest.publication_record pr
            join ingest.normalized_record n using (normalized_record_id)
            join ingest.raw_observation o using (observation_id)
            where pr.publication_id = %s
            order by n.normalized_record_id
            for update of pr, n, o
            """,
            (publication_id,),
        )
        rows = cursor.fetchall()
        if tuple(int(row[0]) for row in rows) != manifest_ids:
            raise ProjectionContractError(
                "publication member lineage differs from frozen manifest"
            )
        result: list[_MemberEvidence] = []
        for row in rows:
            payload = row[6]
            if not isinstance(payload, dict):
                raise ProjectionContractError(
                    "normalized payload must be a JSON object"
                )
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

    @staticmethod
    def _verify_factory_output(
        member: FrozenPublicationMember, projection: AuctionProjection
    ) -> None:
        try:
            canonical = json.dumps(
                member.normalized_payload,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            ).encode("utf-8")
        except (TypeError, ValueError) as error:
            raise ProjectionContractError(
                "locked normalized payload is invalid"
            ) from error
        expected = (
            member.normalized_record_id,
            member.observation_id,
            member.source_system,
            member.endpoint,
            member.parser_version,
            member.raw_content_sha256,
            member.source_entity_id,
            hashlib.sha256(canonical).hexdigest(),
        )
        actual = (
            projection.normalized_record_id,
            projection.observation_id,
            projection.source_system,
            projection.endpoint,
            projection.parser_version,
            projection.raw_content_sha256,
            projection.external_bid_id,
            projection.normalized_payload_sha256,
        )
        if actual != expected:
            raise ProjectionContractError(
                "projection factory output differs from locked member"
            )

    def _mark_projection_failed(
        self, *, publication_id: UUID, failed_at: datetime
    ) -> None:
        with (
            self._failure_connection_factory() as connection,
            connection.transaction(),
            connection.cursor() as cursor,
        ):
            self._mark_projection_failed_locked(
                cursor, publication_id=publication_id, failed_at=failed_at
            )

    @staticmethod
    def _mark_projection_failed_locked(
        cursor: psycopg.Cursor[Any], *, publication_id: UUID, failed_at: datetime
    ) -> None:
        cursor.execute(
            "select run_id from ingest.publication where publication_id = %s",
            (publication_id,),
        )
        owner = cursor.fetchone()
        if owner is None:
            return
        run_id = owner[0]
        cursor.execute(
            """
            select status, started_at from ingest.run
            where run_id = %s for update
            """,
            (run_id,),
        )
        run = cursor.fetchone()
        if run is None:
            return
        cursor.execute(
            """
            select run_id, status, validated_at from ingest.publication
            where publication_id = %s for update
            """,
            (publication_id,),
        )
        publication = cursor.fetchone()
        if (
            publication is None
            or publication[0] != run_id
            or (str(publication[1]), str(run[0])) != ("validated", "validated")
        ):
            return
        if publication[2] is None:
            raise ProjectionContractError(
                "projection failure requires a validation timestamp"
            )
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
            (
                PROJECTION_CONTRACT,
                max(failed_at, run[1], publication[2]),
                run_id,
            ),
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
