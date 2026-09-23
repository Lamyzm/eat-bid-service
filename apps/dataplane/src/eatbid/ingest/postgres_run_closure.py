"""모듈 책임: run을 닫는 두 경로를 소유한다 — 투영이 끝난 자리에서 스스로 닫는 것과, 전진이 멎은 run을 운영자가 닫는 것.

공고 lane과 나눈 이유는 run을 닫는 주체가 다르기 때문이다. 공고는 `ingest.publication`이 running →
validated → published로 옮기지만, 참조 파일과 코드목록에는 그 단계가 아예 없다. 그래서 이 두 lane만
투영이 자기 transaction 안에서 직접 닫는다.

운영자 경로가 따로 필요한 이유는 `fail-release`가 `planned` release만 닫기 때문이다. capture까지
성공해 release가 봉인된 뒤 프로세스가 사라지면 그 run은 어느 경로로도 닫히지 않는다.
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


class StalledRunCloseError(RuntimeError):
    """멈춘 run을 닫으려는 요청이 거부된 이유를 보존한다."""


def close_stalled_run(
    cursor: psycopg.Cursor[Any],
    *,
    run_id: UUID,
    outcome: str,
    ended_at: datetime,
    failure_category: str | None,
    stall_after: str,
) -> str:
    """전진이 멎은 run을 운영자 판정으로 닫는다. 닫은 mode를 돌려준다.

    **왜 자동이 아닌가.** 멎은 run 하나하나가 서로 다른 사실이다. 2026-09-19 운영에 넷이 있었는데,
    하나는 행안부 참조 파일이 사람 승인을 기다리는 살아 있는 결정이었고(ADR 0035), 둘은 EAT-234
    수정 배포 전의 유물로 투영은 실제로 끝난 것이었으며, 하나는 화면을 살리려고 운영자가 workflow를
    멈춰 생긴 것이었다. 넷을 한 규칙으로 닫으면 셋에 거짓을 적는다. 그래서 무엇이 참인지 확인한
    사람이 `outcome`으로 말한다.

    **왜 전진을 다시 보는가.** 기대가 이미 "90분간 관측이 없다"로 멎음을 판정하는데, 닫는 쪽이 그
    판정을 믿고 건너뛰면 그 사이에 되살아난 run을 운영자가 죽일 수 있다. 같은 기준을 닫는 순간에
    한 번 더 확인해 그 창을 없앤다.
    """
    if outcome not in ("published", "failed"):
        raise StalledRunCloseError(f"outcome must be published or failed: {outcome}")
    if outcome == "failed" and failure_category is None:
        raise StalledRunCloseError("failed로 닫으려면 failure_category가 필요하다")
    if outcome == "published" and failure_category is not None:
        raise StalledRunCloseError("published로 닫을 때는 failure_category를 적지 않는다")
    cursor.execute(
        """
        select r.mode,
               coalesce(max(o.fetched_at), r.started_at) as last_progress_at
          from ingest.run r
          left join ingest.raw_observation o using (run_id)
         where r.run_id = %(run_id)s and r.status = 'running'
         group by r.run_id, r.mode, r.started_at
        having coalesce(max(o.fetched_at), r.started_at) < now() - %(stall_after)s::interval
        """,
        {"run_id": run_id, "stall_after": stall_after},
    )
    found = cursor.fetchone()
    if found is None:
        raise StalledRunCloseError(
            f"run이 열려 있지 않거나 아직 전진하고 있다: {run_id}"
        )
    cursor.execute(
        """
        update ingest.run
           set status = %(status)s, ended_at = %(ended_at)s, failure_category = %(category)s
         where run_id = %(run_id)s and status = 'running'
        """,
        {
            "status": outcome,
            "ended_at": ended_at,
            "category": failure_category,
            "run_id": run_id,
        },
    )
    if cursor.rowcount != 1:
        raise StalledRunCloseError(f"run is not open for completion: {run_id}")
    return str(found[0])
