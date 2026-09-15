"""모듈 책임: 감시 한 회차가 끝까지 끝났다는 신호를 클러스터 밖의 dead man's switch에 한 번 보낸다.

왜 밖인가: 안에 있는 감시는 기계와 함께 죽는다. DB가 죽으면 아홉 기대가 텔레그램에 닿기 전에 함께
침묵하고, 침묵은 정상과 구분되지 않는다(ADR 0046 결정 6). 2026-09-10에 옛 VM이 28시간 죽어 있었고
사용자가 물어서 알았다. 바깥은 신호가 끊긴 것을 알림으로 바꾼다.

왜 실패를 예외로 올리는가: 제공자에 닿지 못했을 때 조용히 넘기면 안팎이 함께 침묵한다. 예외로 끝내면
회차가 실패로 남고 안쪽 `cron-workflow` 기대가 15분 안에 텔레그램으로 알린다 — 그것이 EAT-171이 요구한
"제공자 자신의 장애도 알림 대상"이다.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx

__all__ = ["HeartbeatOutcome", "beat"]

HeartbeatOutcome = str
"""`"sent"` 또는 `"skipped"`. 없는 것과 실패한 것은 다른 사실이라 skipped를 따로 둔다 — 실패는 예외다."""

Getter = Callable[..., Any]


def beat(
    url: str | None,
    *,
    get: Getter = httpx.get,
    timeout_seconds: float = 10.0,
) -> HeartbeatOutcome:
    """URL이 있으면 정확히 한 번 GET한다. 4xx·5xx는 예외로 올린다.

    호출 순서가 계약이다: 기대 평가·텔레그램 전송·상태 문서 기록이 **모두 끝난 뒤**에만 부른다. 그 앞에서
    치면 텔레그램 전송 실패를 바깥에 정상으로 보고하게 된다.
    """
    if url is None:
        return "skipped"
    response = get(url, timeout=timeout_seconds)
    response.raise_for_status()
    return "sent"
