"""모듈 책임: 발행 단계가 없는 lane(정부 참조 파일·eaT 코드목록)의 run을 투영이 끝난 자리에서 published로 닫는다.

공고 lane과 나눈 이유는 run을 닫는 주체가 다르기 때문이다. 공고는 `ingest.publication`이 running →
validated → published로 옮기지만, 참조 파일과 코드목록에는 그 단계가 아예 없다. 그래서 이 두 lane만
투영이 자기 transaction 안에서 직접 닫는다.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

import psycopg

from eatbid.core.repository import ProjectionContractError


def close_projection_run(
    cursor: psycopg.Cursor[Any],
    *,
    run_id: UUID,
    ended_at: datetime,
    published_count: int,
) -> None:
    """투영이 끝난 run을 published로 닫는다.

    닫는 코드가 없으면 run이 영원히 `running`으로 남고, `backfill-progress` 기대가 그 run을 "아직 도는
    회차"로 세어 위반이 절대 닫히지 않는다. 운영에서 실제로 그렇게 됐다 — `capture-reference` run
    하나(2026-09-06)와 `capture-code-vocabulary` run 하나(2026-09-16)가 봉인된 release를 남긴 채
    `running`으로 남아 매 회차 텔레그램에 떴다(EAT-234).

    **투영과 같은 transaction에서 닫는다.** 투영이 롤백되면 run도 열린 채로 남아야 "무엇이 끝났는가"가
    거짓이 되지 않는다. 열려 있지 않은 run을 닫으려 하면 멈춘다 — 두 번 닫히는 것은 우리가 실행 정체성을
    잘못 넘겼다는 뜻이지 정상이 아니다.
    """
    cursor.execute(
        """
        update ingest.run
           set status = 'published', ended_at = %s, published_count = %s
         where run_id = %s and status = 'running'
        """,
        (ended_at, published_count, run_id),
    )
    if cursor.rowcount != 1:
        raise ProjectionContractError(f"run is not open for completion: {run_id}")
