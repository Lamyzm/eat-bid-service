"""모듈 책임: 발행 하나를 PostgreSQL에서 잠그고, 봉인된 구성원과 실행 상태가 서로 어긋나지 않는지
확인한 뒤 core 투영과 발행 상태 전이를 한 트랜잭션으로 끝낸다.

행을 쓰는 방법은 writer 모듈들이 갖고, 여기는 무엇을 어떤 순서로 잠그고 어떤 실패를 어떤 범주로
기록할지를 갖는다.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg
from psycopg.pq import TransactionStatus

from eatbid.core.models import AuctionProjection, ProjectResult
from eatbid.core.postgres_projection_writer import CanonicalProjectionWriter
from eatbid.core.postgres_topology import LockedAuctionTopology, lock_auction_topology
from eatbid.core.projection_models import AppliedProjectionCounts
from eatbid.core.projection_stream import (
    PROJECTION_BATCH_SIZE,
    MemberEvidence,
    batched_ids,
    project_member_batches,
)
from eatbid.core.repository import (
    FrozenPublicationMember,
    ProjectionContractError,
    ProjectionFactory,
    ProjectionTransactionScopeError,
    PublishedProjectionEvidence,
)

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


class PsycopgCanonicalProjectionRepository:
    def __init__(
        self,
        connection: psycopg.Connection[Any],
        failure_connection_factory: Callable[[], psycopg.Connection[Any]],
        *,
        batch_size: int = PROJECTION_BATCH_SIZE,
    ) -> None:
        if (
            isinstance(batch_size, bool)
            or not isinstance(batch_size, int)
            or batch_size < 1
        ):
            raise ValueError("projection batch size must be a positive integer")
        self._connection = connection
        self._failure_connection_factory = failure_connection_factory
        self._batch_size = batch_size

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
            # 명단·낙찰은 별도 질의다. 위 질의에 조인하면 revision 하나가 명단 행 수만큼 늘어나
            # `count(distinct ...)` 밖의 수가 전부 흔들린다.
            cursor.execute(
                """
                select
                  (select count(*) from core.bid_submission s
                    where s.auction_revision_id = ar.auction_revision_id),
                  (select count(*) from core.award_decision d
                    where d.auction_revision_id = ar.auction_revision_id)
                from ingest.publication_record pr
                join core.auction_revision ar using (normalized_record_id)
                where pr.publication_id = %s
                """,
                (publication_id,),
            )
            roster_counts = cursor.fetchall()
            return PublishedProjectionEvidence(
                publication_id=publication_id,
                members_projected=result.members_projected,
                organization_count=int(counts[0]),
                auction_attempt_count=int(counts[1]),
                auction_revision_count=int(counts[2]),
                canonical_fingerprint=result.canonical_fingerprint,
                bid_submission_count=sum(int(row[0]) for row in roster_counts),
                award_decision_count=sum(int(row[1]) for row in roster_counts),
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

        manifest_ids = self._lock_members(
            cursor,
            publication_id=publication_id,
            topology=topology,
            expected_count=state.expected_count,
            normalized_count=state.normalized_count,
        )
        allow_insert = state.publication_status == "validated"
        writer = CanonicalProjectionWriter()

        def apply(
            projection: AuctionProjection, observed_at: datetime
        ) -> AppliedProjectionCounts:
            return writer.apply(
                cursor,
                projection=projection,
                observed_at=observed_at,
                allow_insert=allow_insert,
            )

        # 구성원 행은 위에서 전부 잠갔고 여기서는 batch마다 payload만 다시 읽는다. 발행 전체를 한 번에
        # 올리면 16,000건 창에서 노드 메모리를 넘긴다(EAT-94). 한 transaction 안이므로 어느 batch에서
        # 실패해도 공개되는 것은 없다.
        streamed = project_member_batches(
            self._member_batches(
                cursor, manifest_ids, run_parser_version=state.parser_version
            ),
            projection_factory=projection_factory,
            verify_output=self._verify_factory_output,
            apply=apply,
        )
        fingerprint = streamed.canonical_fingerprint
        applied = streamed.applied

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
            members_projected=streamed.members_projected,
            auction_attempts_inserted=applied.auction_attempts,
            auction_revisions_inserted=applied.auction_revisions,
            organizations_inserted=applied.organizations,
            code_values_inserted=applied.code_values,
            code_labels_inserted=applied.code_labels,
            relationships_inserted=applied.relationships,
            canonical_fingerprint=fingerprint,
            supplier_parties_inserted=applied.supplier_parties,
            supplier_accounts_inserted=applied.supplier_accounts,
            bid_submissions_inserted=applied.bid_submissions,
            award_decisions_inserted=applied.award_decisions,
            attempt_links_inserted=applied.attempt_links,
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
        expected_count: int,
        normalized_count: int,
    ) -> tuple[int, ...]:
        """봉인된 manifest와 구성원 행을 전부 잠그고 id만 돌려준다.

        잠금은 발행 전체를 한 번에 잡아야 한다 — batch마다 잠그면 뒤 batch를 잠그기 전에 다른 실행이
        앞 batch의 관측을 바꿀 수 있다. 대신 payload는 여기서 읽지 않는다. id 16,000개는 작지만
        payload 16,000개는 노드 메모리를 넘긴다(EAT-94).
        """
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
            select n.normalized_record_id
            from ingest.publication_record pr
            join ingest.normalized_record n using (normalized_record_id)
            join ingest.raw_observation o using (observation_id)
            where pr.publication_id = %s
            order by n.normalized_record_id
            for update of pr, n, o
            """,
            (publication_id,),
        )
        locked_ids = tuple(int(row[0]) for row in cursor.fetchall())
        if locked_ids != manifest_ids:
            raise ProjectionContractError(
                "publication member lineage differs from frozen manifest"
            )
        return manifest_ids

    def _member_batches(
        self,
        cursor: psycopg.Cursor[Any],
        manifest_ids: tuple[int, ...],
        *,
        run_parser_version: str,
    ) -> Iterator[tuple[MemberEvidence, ...]]:
        """잠근 구성원의 payload를 manifest 순서대로 batch씩 읽는다.

        `for update`를 다시 붙이지 않는 이유는 이 transaction이 `_lock_members`에서 이미 그 행을 잠갔기
        때문이다. batch가 요청한 id와 돌아온 id가 하나라도 다르면 잠근 뒤에 행이 사라진 것이므로 계약
        위반으로 닫는다.
        """
        for batch_ids in batched_ids(manifest_ids, self._batch_size):
            cursor.execute(
                """
                select n.normalized_record_id, n.observation_id, o.source, o.endpoint,
                       n.record_type, n.source_entity_id, n.normalized_payload,
                       n.parser_version, o.content_sha256, o.fetched_at
                from ingest.normalized_record n
                join ingest.raw_observation o using (observation_id)
                where n.normalized_record_id = any(%s)
                order by n.normalized_record_id
                """,
                (list(batch_ids),),
            )
            rows = cursor.fetchall()
            if tuple(int(row[0]) for row in rows) != batch_ids:
                raise ProjectionContractError(
                    "publication member lineage differs from frozen manifest"
                )
            batch: list[MemberEvidence] = []
            for row in rows:
                payload = row[6]
                if not isinstance(payload, dict):
                    raise ProjectionContractError(
                        "normalized payload must be a JSON object"
                    )
                batch.append(
                    MemberEvidence(
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
            del rows
            yield tuple(batch)

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
