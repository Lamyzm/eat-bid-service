"""모듈 책임: 배포 1 이전에 앉은 투찰 행의 빈 `supplier_label`을 같은 계정·같은 관측의 업체명 관측으로 채운다.

업체명을 그 이름이 관측된 투찰 행으로 옮기는 일회성 이행이다(ADR 0063 결정 4·5). 마이그레이션은 대기 중인
파일을 한 트랜잭션으로 적용하므로 4,596만 행을 거기서 갱신하면 표가 통째로 두 벌이 되고 문장 제한(5분)도
넘는다. 그래서 업체(party) 몇십 곳씩 묶어 묶음마다 커밋한다. 빈 칸만 채우므로 중간에 멈춰도 다시 부르면
남은 것부터 이어 가고, 이미 다 채운 뒤 부르면 아무것도 바꾸지 않는다. 배포 2가 옛 업체명 관측 행을 지울
때 이 모듈도 함께 지운다.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

from eatbid.core.repository import ProjectionTransactionScopeError
from eatbid.transaction_scope import require_idle

# 묶음 하나가 고칠 행 수의 목표다. 업체마다 투찰 수가 수십에서 수만까지 달라 업체 수를 고정하면 묶음 크기가
# 수백 배 출렁인다. 그래서 방금 묶음이 고친 행 수를 보고 다음 묶음의 업체 수를 두 배로 늘리거나 반으로 줄인다.
# 운영 실측(2026-10-07, 읽기 전용)에서 업체 32곳·21만 행의 조인을 읽는 데만 30초가 들었다. 10만 행이면 한
# 묶음이 쥐는 행 잠금이 수십 초 안에 풀리리라 본다 — 갱신 비용은 재지 않은 추정이라 첫 제출의 진행 줄로
# 확인한다. 같은 행을 검증하려는 투영은 그만큼만 기다린다.
DEFAULT_TARGET_ROWS = 100_000
_INITIAL_PARTIES = 16
_MAX_PARTIES = 1_024

_PARTY_IDS_SQL = "select supplier_party_id from core.supplier_party order by supplier_party_id"

# 고르는 규칙은 지금 명단 조회(`auction-roster-query.ts`)와 같다 — 같은 계정 코드·같은 관측의 이름 관측 중
# 마지막 행이다. 계정 코드의 라벨은 모두 그 계정의 업체명이므로 체계를 다시 거르지 않는다. 한 계정 코드가
# 두 업체로 관측되면(ADR 0049) 그 라벨을 두 묶음이 함께 읽지만 각 묶음은 자기 업체의 투찰만 고친다.
#
# 투찰 쪽은 `(supplier_party_id, opened_at)` 색인으로, 라벨 쪽은 계정 코드가 맨 앞인 증거 키로 찾는다. 두
# 쪽 모두 이 묶음 업체의 행만 읽으므로 전체 작업량은 표 크기에 비례한다.
_FILL_SQL = """
with named as materialized (
  select distinct on (label.code_value_id, label.observation_id)
         label.code_value_id, label.observation_id, label.label
    from core.source_supplier_account account
    join core.code_label_observation label
      on label.code_value_id = account.account_code_value_id
   where account.supplier_party_id = any(%(parties)s)
   order by label.code_value_id, label.observation_id, label.code_label_observation_id desc
)
update core.bid_submission submission
   set supplier_label = named.label
  from core.source_supplier_account account, named
 where submission.supplier_party_id = any(%(parties)s)
   and submission.supplier_label is null
   and account.source_supplier_account_id = submission.source_supplier_account_id
   and named.code_value_id = account.account_code_value_id
   and named.observation_id = submission.observation_id
"""

# 끝난 뒤에도 비어 있는 행이다. 그 관측에 업체명이 없었던 행이고 0이 아니어도 실패가 아니다. 표 전체를
# 한 번 훑으므로 끝에서 한 번만 센다.
_REMAINING_SQL = "select count(*) from core.bid_submission where supplier_label is null"


@dataclass(frozen=True, slots=True)
class SupplierLabelBackfillProgress:
    """묶음 하나를 커밋한 직후의 누계다. 몇 시간(추정) 걸리는 일이라 끝까지 아무 말이 없으면 멈춘 것과 구별되지 않는다."""

    parties_done: int
    parties: int
    batches: int
    rows_filled: int


@dataclass(frozen=True, slots=True)
class SupplierLabelBackfillReport:
    parties: int
    batches: int
    rows_filled: int
    rows_without_label: int

    def to_document(self) -> dict[str, object]:
        return {
            "parties": self.parties,
            "batches": self.batches,
            "rows_filled": self.rows_filled,
            "rows_without_label": self.rows_without_label,
        }


def next_batch_size(current: int, *, rows_filled: int, target_rows: int) -> int:
    """방금 묶음이 고친 행 수로 다음 묶음의 업체 수를 정한다. 목표의 절반 아래면 두 배, 두 배 위면 반이다."""
    if rows_filled < target_rows // 2:
        return min(current * 2, _MAX_PARTIES)
    if rows_filled > target_rows * 2:
        return max(current // 2, 1)
    return current


def backfill_supplier_labels(
    connection: Any,
    *,
    target_rows: int = DEFAULT_TARGET_ROWS,
    on_progress: Callable[[SupplierLabelBackfillProgress], None] | None = None,
) -> SupplierLabelBackfillReport:
    """모든 업체를 id 순서로 묶어 빈 업체명을 채운다. 묶음마다 커밋한다."""
    if target_rows < 1:
        raise ValueError("target_rows must be positive")
    # 남의 트랜잭션 위에서 시작하면 아래 묶음 블록이 savepoint가 되어 "묶음마다 커밋"이 거짓이 된다. 바깥이
    # 되감기면 채웠다고 보고한 행이 그대로 비어 돌아온다(ADR 0059).
    require_idle(
        connection,
        message="supplier label backfill requires an idle repository connection",
        error_type=ProjectionTransactionScopeError,
    )
    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(_PARTY_IDS_SQL)
        party_ids: Sequence[int] = [int(row[0]) for row in cursor.fetchall()]

    batches = 0
    rows_filled = 0
    size = _INITIAL_PARTIES
    position = 0
    while position < len(party_ids):
        parties = list(party_ids[position : position + size])
        # 묶음 하나가 한 단위다. 블록을 나가며 커밋하므로 뒤 묶음에서 죽어도 여기까지는 남는다.
        with connection.transaction(), connection.cursor() as cursor:
            cursor.execute(_FILL_SQL, {"parties": parties})
            filled = int(cursor.rowcount)
        batches += 1
        rows_filled += filled
        position += len(parties)
        size = next_batch_size(size, rows_filled=filled, target_rows=target_rows)
        if on_progress is not None:
            on_progress(
                SupplierLabelBackfillProgress(
                    parties_done=position,
                    parties=len(party_ids),
                    batches=batches,
                    rows_filled=rows_filled,
                )
            )

    with connection.transaction(), connection.cursor() as cursor:
        cursor.execute(_REMAINING_SQL)
        row = cursor.fetchone()
    return SupplierLabelBackfillReport(
        parties=len(party_ids),
        batches=batches,
        rows_filled=rows_filled,
        rows_without_label=int(row[0]) if row is not None else 0,
    )
