"""모듈 책임: 소스 차단 보류를 `ingest.source_hold`에 적고 열린 보류를 읽는다.

왜 따로인가: 관측 저장소(postgres_repository)는 사실을 적고, 이 저장소는 결정을 적는다. 둘을 섞으면
"어디까지 됐나"와 "무엇을 하지 않기로 했나"가 한 모듈에 살게 되고, ADR 0055가 그은 경계가 흐려진다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.pipeline.source_hold import (
    REASON_THROTTLED,
    RECENT_HOLD_WINDOW,
    SourceHold,
    next_release_after,
)

_OPEN_HOLD_SQL = """
    select hold_id, source, reason, detail, held_at, release_after, held_by_run_id
      from ingest.source_hold
     where source = %(source)s and released_at is null and release_after > %(now)s
     order by release_after desc
     limit 1
"""

_RECENT_COUNT_SQL = """
    select count(*) from ingest.source_hold
     where source = %(source)s and held_at >= %(since)s
"""

_INSERT_SQL = """
    insert into ingest.source_hold (source, reason, detail, held_at, held_by_run_id, release_after)
    values (%(source)s, %(reason)s, %(detail)s, %(held_at)s, %(held_by_run_id)s, %(release_after)s)
    returning hold_id
"""


class PsycopgSourceHoldRepository:
    def __init__(self, connection: psycopg.Connection[Any]) -> None:
        self._connection = connection

    def open_hold(self, source: str, *, now: datetime) -> SourceHold | None:
        # 읽기도 transaction 블록 안에서 한다. 이 조회는 정시 수집이 소스를 부르기 전 첫 DB 접근이라,
        # 블록 없이 커서만 쓰면 psycopg가 연 암묵 transaction이 그대로 남는다. 그러면 뒤따르는 discover의
        # 모든 쓰기가 savepoint로 감싸여 프로세스 종료 때 통째로 되돌아간다 — 단계는 성공으로 끝나고 행만
        # 사라진다(2026-09-17 정시 수집 21시간 중단, EAT-264).
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(_OPEN_HOLD_SQL, {"source": source, "now": now})
            row = cursor.fetchone()
        if row is None:
            return None
        return SourceHold(
            hold_id=int(row[0]),
            source=str(row[1]),
            reason=str(row[2]),
            detail=str(row[3]),
            held_at=row[4],
            release_after=row[5],
            held_by_run_id=row[6],
        )

    def record_throttle(
        self, *, source: str, run_id: UUID | None, detail: str, now: datetime
    ) -> SourceHold:
        """차단 응답을 본 자리에서 보류를 적는다. 길이는 지난 24시간의 보류 수가 정한다(ADR 0055 결정 2)."""
        with self._connection.transaction(), self._connection.cursor() as cursor:
            cursor.execute(
                _RECENT_COUNT_SQL, {"source": source, "since": now - RECENT_HOLD_WINDOW}
            )
            recent = int((cursor.fetchone() or (0,))[0])
            release_after = next_release_after(recent_holds=recent, now=now)
            cursor.execute(
                _INSERT_SQL,
                {
                    "source": source,
                    "reason": REASON_THROTTLED,
                    "detail": detail,
                    "held_at": now,
                    "held_by_run_id": run_id,
                    "release_after": release_after,
                },
            )
            hold_id = int((cursor.fetchone() or (0,))[0])
        return SourceHold(
            hold_id=hold_id,
            source=source,
            reason=REASON_THROTTLED,
            detail=detail,
            held_at=now,
            release_after=release_after,
            held_by_run_id=run_id,
        )
