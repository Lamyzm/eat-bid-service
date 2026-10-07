"""모듈 책임: 배포 1 이전에 앉은 revision의 빈 열 넷을 그 revision의 `source_payload`에서 채운다.

`source_payload` jsonb 경로로 읽던 값을 열로 옮기는 일회성 이행이다(EAT-308). 열을 더한 마이그레이션 트랜잭션은
끝날 때까지 표 전체를 잠그므로 같은 자리에서 jsonb 7GB를 읽어 갱신하면 그동안 화면 조회가 모두 멈춘다. 그래서
revision id 범위마다 커밋한다. 빈 행(`lineage_observed is null`)만 채우므로 중간에 멈춰도 다시 부르면 남은 것부터
이어 가고, 다 채운 뒤 부르면 아무것도 바꾸지 않는다. 배포 2가 `source_payload`를 지울 때 이 모듈도 함께 지운다.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from eatbid.core.repository import ProjectionTransactionScopeError
from eatbid.transaction_scope import require_idle

# 범위 하나의 revision id 폭이다. 운영 실측(2026-10-07, 읽기 전용)에서 126만 행의 jsonb를 전부 읽는 데 2분 5초가
# 들었으므로 2만 행이면 범위 하나가 몇 초다 — 갱신 비용은 재지 않은 추정이라 진행 줄로 확인한다. 같은 revision을
# 검증하려는 투영은 그동안만 기다린다.
DEFAULT_BATCH_REVISIONS = 20_000

_BOUNDS_SQL = "select min(auction_revision_id), max(auction_revision_id) from core.auction_revision"

# 식은 지금 읽는 쪽이 jsonb에서 꺼내는 식과 같다 — 명단 줄 수와 원본 명단 크기는 서버 명단 조회
# (`auction-roster-query.ts`·`own-bid-query.ts`), 품목 라벨은 상세 조회(`drizzle-auction-reader.ts`)와 mart 둘,
# 사슬 관측은 회차 요약 mart(`org_round_summary.py`). 같아야 배포 2에서 읽는 자리를 바꿔도 화면이 그대로다.
_FILL_SQL = """
update core.auction_revision
   set roster_submission_count = case
         when jsonb_typeof(source_payload #> '{roster,submissions}') = 'array'
         then jsonb_array_length(source_payload #> '{roster,submissions}')
       end,
       source_roster_size = (source_payload #>> '{roster,sourceRosterSize}')::integer,
       source_category_label = source_payload #>> '{classification,sourceCategoryLabel}',
       lineage_observed = source_payload ? 'lineage'
 where auction_revision_id >= %(low)s and auction_revision_id < %(high)s
   and lineage_observed is null
"""

_REMAINING_SQL = "select count(*) from core.auction_revision where lineage_observed is null"


@dataclass(frozen=True, slots=True)
class RevisionColumnBackfillProgress:
    """범위 하나를 커밋한 직후의 누계다."""

    next_revision_id: int
    last_revision_id: int
    batches: int
    rows_filled: int


@dataclass(frozen=True, slots=True)
class RevisionColumnBackfillReport:
    batches: int
    rows_filled: int
    rows_unfilled: int

    def to_document(self) -> dict[str, object]:
        return {
            "batches": self.batches,
            "rows_filled": self.rows_filled,
            "rows_unfilled": self.rows_unfilled,
        }


def backfill_revision_columns(
    connection: Any,
    *,
    batch_revisions: int = DEFAULT_BATCH_REVISIONS,
    on_progress: Callable[[RevisionColumnBackfillProgress], None] | None = None,
) -> RevisionColumnBackfillReport:
    """revision id를 처음부터 끝까지 범위로 나눠 빈 열을 채운다. 범위마다 커밋한다."""
    if batch_revisions < 1:
        raise ValueError("batch_revisions must be positive")
    # 남의 트랜잭션 위에서 시작하면 아래 범위 블록이 savepoint가 되어 "범위마다 커밋"이 거짓이 된다(ADR 0059).
    require_idle(
        connection,
        message="revision column backfill requires an idle repository connection",
        error_type=ProjectionTransactionScopeError,
    )
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(_BOUNDS_SQL)
        bounds = cursor.fetchone()
    batches = 0
    rows_filled = 0
    if bounds is not None and bounds[0] is not None:
        first, last = int(bounds[0]), int(bounds[1])
        low = first
        while low <= last:
            high = low + batch_revisions
            # 범위 하나가 한 단위다. 블록을 나가며 커밋하므로 뒤 범위에서 죽어도 여기까지는 남는다.
            with connection.transaction(), connection.cursor() as cursor:
                cursor.execute(_FILL_SQL, {"low": low, "high": high})
                rows_filled += int(cursor.rowcount)
            batches += 1
            low = high
            if on_progress is not None:
                on_progress(
                    RevisionColumnBackfillProgress(
                        next_revision_id=low,
                        last_revision_id=last,
                        batches=batches,
                        rows_filled=rows_filled,
                    )
                )
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(_REMAINING_SQL)
        row = cursor.fetchone()
    return RevisionColumnBackfillReport(
        batches=batches,
        rows_filled=rows_filled,
        rows_unfilled=int(row[0]) if row is not None else 0,
    )
