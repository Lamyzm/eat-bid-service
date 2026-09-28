"""모듈 책임: 실행 하나의 정규화 결과를 PostgreSQL에서 검증해 발행 manifest와 제외 원장으로 봉인하고, 소스
계약과 완결성 판정의 실패를 실행 상태로 남긴다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.core.postgres_topology import (
    LockedAuctionTopology,
    lock_auction_topology,
    lock_publication_exclusions,
)
from eatbid.failures.categories import (
    DATA_QUARANTINED,
    PRE_VALIDATION_FAILURE_CATEGORIES,
    PROJECTION_CONTRACT,
    SOURCE_CONTRACT,
)
from eatbid.ingest.postgres_publication_exclusion import record_normalize_exclusions
from eatbid.ingest.publication_repository import (
    CompletenessValidator,
    PublicationValidation,
    QuarantinedRecord,
    RecordExclusion,
    SourceContractValidator,
)
from eatbid.source.eat.code_schemes import FOUNDATION_CODE_SCHEMES

# 발행 완결성 검사가 존재를 요구하는 scheme이다. 이름의 권위는 `source/eat/code_schemes.py`이며
# 여기서 다시 적으면 같은 체계에 두 이름이 생긴다(AGENTS 2·6).
REQUIRED_SCHEMES = tuple(
    scheme.namespace for scheme in FOUNDATION_CODE_SCHEMES
)


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
                from ingest.run where run_id = %s for no key update
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
            # 소스 계약은 해석에 성공한 시도에서만 센다. 격리된 시도의 지문은 그 관측 하나가 깨졌다는 기록이라
            # 범위가 그 한 건이고(ADR 0061 결정 2), 그 격리가 레코드 범위인지는 완결 검증기가 사유로 가른다.
            # 여기서 세면 XML 한 건이 깨질 때마다(지문이 없다) 창 전체가 소스 계약 위반으로 막힌다.
            schema_contract_violations = sum(
                not source_contract_validator(
                    source=attempt.source,
                    endpoint=attempt.endpoint,
                    parser_version=attempt.parser_version,
                    schema_fingerprint=attempt.schema_fingerprint,
                )
                for attempt in topology.current_attempts
                if attempt.status != "quarantined"
            )
            source_entities = [member.source_entity_id for member in topology.members]
            duplicate_source_entities = len(source_entities) - len(set(source_entities))
            missing_schemes = self._missing_schemes(cursor)
            # 시도가 없는 후보는 격리가 아니다. 격리 목록에 섞지 않으므로 "정규화 + 격리 = 관측" 등식과
            # `settled`가 그것을 창 전체 결함으로 막는다.
            report = completeness_validator(
                request_counts=request_counts,
                expected_count=int(expected_count),
                normalized=len(topology.members),
                quarantined=tuple(
                    QuarantinedRecord(
                        observation_id=attempt.observation_id,
                        reason=attempt.quarantine_reason or "",
                    )
                    for attempt in topology.quarantined_attempts
                ),
                duplicate_source_entities=duplicate_source_entities,
                missing_code_schemes=missing_schemes,
                schema_contract_violations=schema_contract_violations,
            )
            # 저장소가 잠근 lineage로만 볼 수 있는 창 전체 결함이다(ADR 0061 결정 2): 실패한 요청, 기대 수와
            # 다른 후보 수, parser_version 불일치, 시도 누락·격리에 붙은 구성원·모르는 record_type
            # (`settled`가 `partial_coherent`로 본다). 격리 자체는 여기서 결함이 아니다.
            ledger_coherent = (
                failed_requests == 0
                and len(topology.candidate_ids) == int(expected_count)
                and topology.parser_mismatches == 0
                and topology.settled
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
                    topology=topology,
                )
            if report.publishable and ledger_coherent:
                consume_pending = self._consume_pending(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    expected_count=int(expected_count),
                    required=mode == "replay",
                )
                excluded_count = self._persist_validated(
                    cursor,
                    run_id=run_id,
                    publication_id=publication_id,
                    validated_at=validated_at,
                    expected_count=int(expected_count),
                    topology=topology,
                    exclusions=report.exclusions,
                    consume_pending=consume_pending,
                )
                return PublicationValidation(
                    publication_id=publication_id,
                    run_id=run_id,
                    status="validated",
                    expected_count=int(expected_count),
                    normalized_count=len(topology.member_ids),
                    member_ids=topology.member_ids,
                    excluded_count=excluded_count,
                )

            consume_pending = self._consume_pending(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                expected_count=int(expected_count),
                required=mode == "replay",
            )
            failure_category = (
                DATA_QUARANTINED
                if topology.quarantined_current_attempts > 0
                else SOURCE_CONTRACT
            )
            self._persist_failed(
                cursor,
                run_id=run_id,
                publication_id=publication_id,
                failed_at=validated_at,
                expected_count=int(expected_count),
                normalized_count=len(topology.members),
                failure_category=failure_category,
                consume_pending=consume_pending,
            )
            return PublicationValidation(
                publication_id=publication_id,
                run_id=run_id,
                status="failed",
                expected_count=int(expected_count),
                normalized_count=len(topology.members),
                member_ids=(),
                failure_category=failure_category,
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
            from ingest.publication where run_id = %s for no key update
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
            order by request_unit_id for no key update
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
        topology: LockedAuctionTopology,
        exclusions: tuple[RecordExclusion, ...],
        consume_pending: bool,
    ) -> int:
        """구성원 manifest와 제외 원장을 같은 transaction에서 봉인하고 제외 수를 돌려준다.

        제외는 지금 격리된 관측과 정확히 같아야 한다. 검증기가 격리마다 한 항목을 돌려주는 것을 믿지 않고
        여기서 다시 대조하는 이유는 원장이 "기록된 결손"의 권위이기 때문이다(ADR 0061 결정 4).
        """
        member_ids = topology.member_ids
        excluded_ids = tuple(exclusion.observation_id for exclusion in exclusions)
        if (
            excluded_ids != topology.quarantined_observation_ids
            or len(member_ids) + len(excluded_ids) != expected_count
        ):
            raise PublicationIntegrityError(
                "validated members and exclusions do not cover the expected count"
            )
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
        return record_normalize_exclusions(
            cursor, publication_id=publication_id, run_id=run_id, exclusions=exclusions
        )

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
        topology: LockedAuctionTopology,
    ) -> PublicationValidation:
        current_normalized_count = len(topology.members)
        current_member_ids = topology.member_ids
        cursor.execute(
            """
            select publication_id, status, validated_at, activated_at,
                   expected_count, normalized_count, published_count,
                   canonical_fingerprint, projector_version, excluded_count
            from ingest.publication where run_id = %s for no key update
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
        elif run_failure_category in PRE_VALIDATION_FAILURE_CATEGORIES:
            # 검증에 들어가기 전에 닫힌 실패라 발행 검증 시각이 있을 수 없다. 카테고리 목록을 여기서
            # 다시 적으면 새 어휘가 늘 때마다 어느 판정에도 걸리지 않는 run 상태가 생긴다.
            if publication[2] is not None:
                raise PublicationIntegrityError(
                    "pre-validation failure cannot have a validation timestamp"
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
            for no key update
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
        # 제외도 구성원과 같은 규칙으로 봉인됐다. 검증을 통과한 발행이면 원장이 지금 격리된 관측과 정확히
        # 같고, 검증 전에 실패한 발행은 제외를 적지 않는다.
        excluded_ids = tuple(
            exclusion.observation_id
            for exclusion in lock_publication_exclusions(
                cursor, publication_id=publication_id
            )
        )
        expected_excluded_ids = (
            topology.quarantined_observation_ids
            if run_status == "validated" or run_failure_category == PROJECTION_CONTRACT
            else ()
        )
        if excluded_ids != expected_excluded_ids or int(publication[9]) != len(
            excluded_ids
        ):
            raise PublicationIntegrityError(
                "terminal publication exclusions differ from current lineage"
            )
        return PublicationValidation(
            publication_id=publication_id,
            run_id=run_id,
            status=publication_status,
            expected_count=int(publication[4]),
            normalized_count=int(publication[5]),
            member_ids=member_ids,
            excluded_count=len(excluded_ids),
            # 재호출도 같은 typed failure로 끝나야 한다. run에 남은 category가 그 권위다.
            failure_category=(
                run_failure_category if publication_status == "failed" else None
            ),
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
