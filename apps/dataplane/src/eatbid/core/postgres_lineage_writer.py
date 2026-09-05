"""모듈 책임: 관측된 재입찰 사슬을 `core.auction_attempt_link`에 앉히고, 아직 수집하지 않은 사슬
상대에게 identity 전용 `core.auction_attempt` 행을 먼저 발급한다.

상대를 외부 문자열로 들고 있다가 나중에 잇지 않는 이유는 문자열이 관계 키가 되기 때문이다(AGENTS 2).
그 대가로 revision이 0개인 attempt가 생기며, 그것은 "관계로만 알려진 공고"라는 유효한 상태다.
"""

from __future__ import annotations

from typing import Any

import psycopg

from eatbid.core.postgres_code_values import resolve_code_value
from eatbid.core.projection_models import (
    AppliedProjectionCounts,
    AttemptLinkProjection,
    AuctionV2Projection,
    comparable_row,
)
from eatbid.core.repository import ProjectionContractError

_LINK_COLUMNS = (
    "auction_revision_id, from_auction_attempt_id, to_auction_attempt_id, relation, "
    "display_bid_no, source_status_code_value_id, bid_opened_from, bid_closed_at, "
    "base_amount, planned_amount, currency, observation_id"
)


class LineageProjectionWriter:
    """revision 하나가 관측한 사슬 관계를 옮긴다."""

    def apply(
        self,
        cursor: psycopg.Cursor[Any],
        *,
        projection: AuctionV2Projection,
        revision_id: int,
        attempt_id: int,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        counts = AppliedProjectionCounts()
        for link in projection.attempt_links:
            counts += self._apply_link(
                cursor,
                link,
                projection=projection,
                revision_id=revision_id,
                attempt_id=attempt_id,
                allow_insert=allow_insert,
            )
        return counts

    def _apply_link(
        self,
        cursor: psycopg.Cursor[Any],
        link: AttemptLinkProjection,
        *,
        projection: AuctionV2Projection,
        revision_id: int,
        attempt_id: int,
        allow_insert: bool,
    ) -> AppliedProjectionCounts:
        target_id, attempts_inserted = self._resolve_target_attempt(
            cursor,
            source_system=projection.source_system,
            external_bid_id=link.to_external_bid_id,
            allow_insert=allow_insert,
        )
        code_values = 0
        status_code_value_id: int | None = None
        if link.source_status is not None:
            status_code_value_id, code_values = resolve_code_value(
                cursor,
                namespace=link.source_status.namespace,
                code=link.source_status.code,
                allow_insert=allow_insert,
            )
        values = (
            revision_id,
            attempt_id,
            target_id,
            link.relation,
            link.display_bid_no,
            status_code_value_id,
            link.bid_opened_from,
            link.bid_closed_at,
            link.base_amount,
            link.planned_amount,
            link.currency,
            projection.observation_id,
        )
        base = AppliedProjectionCounts(
            auction_attempts=attempts_inserted, code_values=code_values
        )
        if allow_insert:
            cursor.execute(
                f"""
                insert into core.auction_attempt_link ({_LINK_COLUMNS})
                values ({", ".join("%s" for _ in values)})
                on conflict (auction_revision_id, to_auction_attempt_id, relation)
                do nothing
                returning auction_attempt_link_id
                """,
                values,
            )
            if cursor.fetchone() is not None:
                return base + AppliedProjectionCounts(attempt_links=1)
        cursor.execute(
            f"""
            select {_LINK_COLUMNS} from core.auction_attempt_link
            where auction_revision_id = %s and to_auction_attempt_id = %s
              and relation = %s
            for update
            """,
            (revision_id, target_id, link.relation),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published attempt link is missing")
        if comparable_row(existing) != comparable_row(values):
            raise ProjectionContractError("persisted attempt link conflicts")
        return base

    @staticmethod
    def _resolve_target_attempt(
        cursor: psycopg.Cursor[Any],
        *,
        source_system: str,
        external_bid_id: str,
        allow_insert: bool,
    ) -> tuple[int, int]:
        """상대 공고의 내부 id를 얻는다. 없으면 identity 전용 행을 먼저 만든다.

        revision 없이 만들어지는 행이므로 공고 수를 세는 질의는 revision 존재를 조건으로 삼아야 한다
        (ADR 0033 §1, `domain-and-data.md` §3.1).
        """
        if allow_insert:
            cursor.execute(
                """
                insert into core.auction_attempt (source_system, external_bid_id)
                values (%s, %s)
                on conflict (source_system, external_bid_id) do nothing
                returning auction_attempt_id
                """,
                (source_system, external_bid_id),
            )
            inserted = cursor.fetchone()
            if inserted is not None:
                return int(inserted[0]), 1
        cursor.execute(
            """
            select auction_attempt_id from core.auction_attempt
            where source_system = %s and external_bid_id = %s for update
            """,
            (source_system, external_bid_id),
        )
        existing = cursor.fetchone()
        if existing is None:
            raise ProjectionContractError("published chain auction attempt is missing")
        return int(existing[0]), 0
