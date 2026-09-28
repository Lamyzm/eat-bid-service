"""모듈 책임: 검증을 통과한 발행의 `normalize` 단계 제외를 `ingest.publication_exclusion`에 적고, 발행과 run의
`excluded_count`를 원장 행 수와 같은 transaction에서 맞춘다(ADR 0061 결정 4).
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

import psycopg

from eatbid.ingest.publication_repository import RecordExclusion

# 원장 `reason` 열의 check(`publication_exclusion_reason_bounded`)와 같은 상한이다.
_MAX_REASON = 500


class PublicationExclusionIntegrityError(RuntimeError):
    """발행의 제외 수와 원장 행이 서로 어긋난다."""


def record_normalize_exclusions(
    cursor: psycopg.Cursor[Any],
    *,
    publication_id: UUID,
    run_id: UUID,
    exclusions: tuple[RecordExclusion, ...],
) -> int:
    """제외마다 원장 한 행을 적고, 발행·run의 제외 수를 적은 뒤 저장된 행을 다시 세어 대조한다.

    `normalize` 단계의 제외는 정규화 레코드가 없다 — 그 관측이 레코드를 하나도 만들지 못했기 때문이다(원장
    check `publication_exclusion_stage_record`). 수를 인자로 믿지 않고 원장을 다시 세는 이유는 등식의 권위가
    원장이기 때문이다. 어긋나면 예외로 블록 전체를 되감는다 — 원장에 없는 결손이나 수에 없는 원장 행은 둘 다
    "기록된 결손"이 아니다.
    """
    if exclusions:
        cursor.executemany(
            """
            insert into ingest.publication_exclusion (
                publication_id, observation_id, normalized_record_id, stage,
                reason_code, reason
            ) values (%s, %s, null, 'normalize', %s, %s)
            """,
            [
                (
                    publication_id,
                    exclusion.observation_id,
                    exclusion.reason_code,
                    exclusion.reason[:_MAX_REASON],
                )
                for exclusion in exclusions
            ],
        )
    cursor.execute(
        """
        update ingest.publication set excluded_count = %s
        where publication_id = %s and run_id = %s and status = 'validated'
        """,
        (len(exclusions), publication_id, run_id),
    )
    if cursor.rowcount != 1:
        raise PublicationExclusionIntegrityError(
            "publication exclusion count was not recorded"
        )
    cursor.execute(
        """
        update ingest.run set excluded_count = %s
        where run_id = %s and status = 'validated'
        """,
        (len(exclusions), run_id),
    )
    if cursor.rowcount != 1:
        raise PublicationExclusionIntegrityError("run exclusion count was not recorded")
    cursor.execute(
        """
        select p.excluded_count, r.excluded_count,
               (select count(*) from ingest.publication_exclusion e
                 where e.publication_id = p.publication_id)
        from ingest.publication p
        join ingest.run r on r.run_id = p.run_id
        where p.publication_id = %s and p.run_id = %s
        """,
        (publication_id, run_id),
    )
    row = cursor.fetchone()
    if row is None:
        raise PublicationExclusionIntegrityError("publication or run disappeared")
    publication_count, run_count, ledger_count = (int(value) for value in row)
    if not publication_count == run_count == ledger_count == len(exclusions):
        raise PublicationExclusionIntegrityError(
            "excluded_count differs from the publication exclusion ledger"
        )
    return ledger_count
