"""모듈 책임: 관측된 명단 행과 낙찰 판정을 `core.bid_submission`·`core.award_decision`에
insert-or-verify로 앉히고, 낙찰 좌표가 실제 명단 행을 가리키는지 같은 트랜잭션에서 확인한다.

삭제-재삽입을 쓰지 않는 이유는 봉인된 발행물이 append-only이고, 부분 삭제 후 실패가 현재 공개 뷰를
비우기 때문이다(ADR 0033 §4-다).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from eatbid.core.postgres_code_values import resolve_code_value, resolve_observation
from eatbid.core.postgres_supplier_writer import (
    ResolvedSupplier,
    SupplierProjectionWriter,
)
from eatbid.core.projection_models import (
    AppliedProjectionCounts,
    AuctionV2Projection,
    AwardProjection,
    SubmissionProjection,
    comparable_row,
)
from eatbid.core.repository import ProjectionContractError

_SUBMISSION_COLUMNS = (
    "auction_revision_id, auction_attempt_id, opened_at, roster_ordinal, "
    "source_supplier_account_id, supplier_party_id, submitted_at, amount, "
    "effective_amount, currency, bid_rate, rank, source_status_code_value_id, "
    "withdrawal_code_value_id, draw_numbers, observed_roster_size, observation_id"
)
_AWARD_COLUMNS = (
    "auction_revision_id, auction_attempt_id, awarded_roster_ordinal, "
    "source_supplier_account_id, supplier_party_id, awarded_at, awarded_amount, "
    "currency, awarded_rate, runner_up_rate, source_status_code_value_id, observation_id"
)


class RosterProjectionWriter:
    """revision 하나의 명단과 낙찰 판정을 옮긴다."""

    def __init__(self, suppliers: SupplierProjectionWriter | None = None) -> None:
        self._suppliers = suppliers or SupplierProjectionWriter()

    def apply(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        projection: AuctionV2Projection,
        revision_id: int,
        attempt_id: int,
        observed_at: datetime,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        counts = AppliedProjectionCounts()
        suppliers: dict[int, ResolvedSupplier] = {}
        for submission in projection.roster.submissions:
            supplier, supplier_counts = self._suppliers.resolve(
                cursor,
                submission.supplier,
                observation_id=projection.observation_id,
                observed_at=observed_at,
                allow_insert=allow_insert,
            )
            suppliers[submission.roster_ordinal] = supplier
            counts += supplier_counts + self._apply_submission(
                cursor,
                submission,
                projection=projection,
                revision_id=revision_id,
                attempt_id=attempt_id,
                supplier=supplier,
                observed_at=observed_at,
                allow_insert=allow_insert,
            )
        self._verify_roster_cardinality(
            cursor, revision_id=revision_id, expected=len(projection.roster.submissions)
        )
        if projection.award is not None:
            counts += self._apply_award(
                cursor,
                projection.award,
                projection=projection,
                revision_id=revision_id,
                attempt_id=attempt_id,
                supplier=suppliers[projection.award.awarded_roster_ordinal],
                observed_at=observed_at,
                allow_insert=allow_insert,
            )
        return counts

    def _apply_submission(
        self,
        cursor: psycopg.Cursor[Any],
        submission: SubmissionProjection,
        *,
        projection: AuctionV2Projection,
        revision_id: int,
        attempt_id: int,
        supplier: ResolvedSupplier,
        observed_at: datetime,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        status_code_value_id, code_values, code_labels = resolve_observation(
            cursor,
            submission.source_status,
            observation_id=projection.observation_id,
            observed_at=observed_at,
            allow_insert=allow_insert,
        )
        withdrawal_code_value_id: int | None = None
        if submission.withdrawal is not None:
            withdrawal_code_value_id, inserted = resolve_code_value(
                cursor,
                namespace=submission.withdrawal.namespace,
                code=submission.withdrawal.code,
                allow_insert=allow_insert,
            )
            code_values += inserted
        values = (
            revision_id,
            attempt_id,
            projection.opened_at,
            submission.roster_ordinal,
            supplier.source_supplier_account_id,
            supplier.supplier_party_id,
            submission.submitted_at,
            submission.amount,
            submission.effective_amount,
            submission.currency,
            submission.bid_rate,
            submission.rank,
            status_code_value_id,
            withdrawal_code_value_id,
            list(submission.draw_numbers),
            submission.observed_roster_size,
            projection.observation_id,
        )
        base = AppliedProjectionCounts(code_values=code_values, code_labels=code_labels)
        if allow_insert:
            cursor.execute(
                f"""
                insert into core.bid_submission ({_SUBMISSION_COLUMNS})
                values ({", ".join("%s" for _ in values)})
                on conflict (auction_revision_id, roster_ordinal, opened_at)
                do nothing
                returning bid_submission_id
                """,
                values,
            )
            if cursor.fetchone() is not None:
                return base + AppliedProjectionCounts(bid_submissions=1)
        cursor.execute(
            f"""
            select {_SUBMISSION_COLUMNS} from core.bid_submission
            where auction_revision_id = %s and roster_ordinal = %s
              and opened_at is not distinct from %s
            for update
            """,
            (revision_id, submission.roster_ordinal, projection.opened_at),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published bid submission is missing")
        if comparable_row(existing) != comparable_row(values):
            raise ProjectionContractError("persisted bid submission conflicts")
        return base

    def _apply_award(
        self,
        cursor: psycopg.Cursor[Any],
        award: AwardProjection,
        *,
        projection: AuctionV2Projection,
        revision_id: int,
        attempt_id: int,
        supplier: ResolvedSupplier,
        observed_at: datetime,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        self._verify_award_coordinate(
            cursor,
            revision_id=revision_id,
            opened_at=projection.opened_at,
            award=award,
        )
        status_code_value_id, code_values, code_labels = resolve_observation(
            cursor,
            award.source_status,
            observation_id=projection.observation_id,
            observed_at=observed_at,
            allow_insert=allow_insert,
        )
        values = (
            revision_id,
            attempt_id,
            award.awarded_roster_ordinal,
            supplier.source_supplier_account_id,
            supplier.supplier_party_id,
            award.awarded_at,
            award.awarded_amount,
            award.currency,
            award.awarded_rate,
            award.runner_up_rate,
            status_code_value_id,
            projection.observation_id,
        )
        base = AppliedProjectionCounts(code_values=code_values, code_labels=code_labels)
        if allow_insert:
            cursor.execute(
                f"""
                insert into core.award_decision ({_AWARD_COLUMNS})
                values ({", ".join("%s" for _ in values)})
                on conflict (auction_revision_id) do nothing
                returning award_decision_id
                """,
                values,
            )
            if cursor.fetchone() is not None:
                return base + AppliedProjectionCounts(award_decisions=1)
        cursor.execute(
            f"""
            select {_AWARD_COLUMNS} from core.award_decision
            where auction_revision_id = %s for update
            """,
            (revision_id,),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published award decision is missing")
        if comparable_row(existing) != comparable_row(values):
            raise ProjectionContractError("persisted award decision conflicts")
        return base

    @staticmethod
    def _verify_award_coordinate(
        cursor: psycopg.Cursor[Any],
        *,
        revision_id: int,
        opened_at: datetime | None,
        award: AwardProjection,
    ) -> None:
        """낙찰 좌표를 FK 대신 여기서 확인한다(ADR 0033 §4-라).

        판정 코드까지 다시 읽는 이유는 좌표만 맞고 그 행이 낙찰 행이 아닌 상태를 참조 무결성이 잡지
        못하기 때문이다.
        """
        cursor.execute(
            """
            select v.code
            from core.bid_submission s
            join core.code_value v
              on v.code_value_id = s.source_status_code_value_id
            where s.auction_revision_id = %s and s.roster_ordinal = %s
              and s.opened_at is not distinct from %s
            """,
            (revision_id, award.awarded_roster_ordinal, opened_at),
        )
        row = cursor.fetchone()
        if row is None:
            raise ProjectionContractError("award decision coordinates a missing roster row")
        if str(row[0]) != award.source_status.code:
            raise ProjectionContractError("award decision status differs from the roster row")

    @staticmethod
    def _verify_roster_cardinality(
        cursor: psycopg.Cursor[Any], *, revision_id: int, expected: int
    ) -> None:
        """이 revision에 관측한 것보다 많은 명단 행이 남아 있으면 끊는다.

        재발행이 upsert라 이전 발행의 여분 행이 조용히 살아남을 수 있다. 그것을 지우지 않고 실패로
        끊는 이유는 삭제가 append-only 계약을 어기기 때문이다.
        """
        cursor.execute(
            "select count(*) from core.bid_submission where auction_revision_id = %s",
            (revision_id,),
        )
        row = cursor.fetchone()
        if row is None or int(row[0]) != expected:
            raise ProjectionContractError("persisted roster cardinality differs")
