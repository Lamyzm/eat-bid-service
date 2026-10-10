"""모듈 책임: mart 빌드가 공고 시도의 최신 개정본을 고르는 정렬 규칙을 한곳에 둔다(EAT-333, ADR 0065)."""

from __future__ import annotations

import re

_ALIAS = re.compile(r"^[a-z_][a-z0-9_]*$")


def latest_revision_order(alias: str) -> str:
    """`core.auction_revision` 별칭에 붙일 최신 정렬이다.

    최신은 개정본 번호가 아니라 관측 번호 순이다. 개정본 번호는 투영 순서라서 재처리가 옛 관측을 다시 투영하거나 오래 걸린
    정시 수집 회차가 늦게 투영하면 번호가 커도 옛 상태가 된다(2026-09 회차 11,162건 중 10,849건). 관측 번호는 raw를 받은
    순서이고 모든 달에서 관측 시각 순과 같았다. 같은 관측을 다시 해석한 개정본이 여럿이면 나중 해석을 쓴다. 서버 조회의
    `latest-revision-order.ts`와 같은 규칙이다.
    """
    if not _ALIAS.match(alias):
        raise ValueError(f"not a SQL alias: {alias!r}")
    return f"{alias}.observation_id desc, {alias}.auction_revision_id desc"
