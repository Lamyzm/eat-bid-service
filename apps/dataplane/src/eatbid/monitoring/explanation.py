"""모듈 책임: 위반 하나를 사람이 읽는 세 문장(무슨 일·영향·급함)으로 선언하는 값과 그 공통 문구를 소유한다.

왜 선언인가: 알림이 기대 title과 `key=value` detail만 실으면 받는 사람은 그것이 화면에 무엇을 뜻하는지
다시 해석해야 하고, 그 해석이 사고 시간이 된다(2026-09-29 사용자: "위반만 떠서 지금 괜찮은지 알 수 없다").
설명은 기대를 선언하는 자리에 함께 적어 기대가 늘 때 설명이 빠지지 않게 한다 — 빠진 것은 검사가 막는다.

왜 급함이 문장인가: severity는 재알림 정책(ADR 0054 결정 1)을 고르는 기계용 값이고, 사람에게는 "지금
움직여야 하나, 오늘 안이면 되나"가 필요하다. 두 값이 어긋나지 않게 급함 문장은 아래 두 상수에서만 고른다.
"""

from __future__ import annotations

from dataclasses import dataclass

URGENT_NOW = "지금 봐야 함 — 풀릴 때까지 1시간마다 다시 알림"
"""critical 위반의 급함. runner.REPEAT_AFTER와 같은 간격을 말한다."""

TODAY = "오늘 안에 보면 됨 — 하루 두 번 상태 보고에 계속 실림"
"""normal 위반의 급함. 재알림 없이 상태 보고에만 실린다."""


@dataclass(frozen=True)
class Explanation:
    """위반을 사람 말로 옮긴 세 문장."""

    what: str
    impact: str
    urgency: str


def urgency_for(severity: str) -> str:
    """severity에서 급함 문장을 고른다. 선언이 급함을 직접 적지 않는 이유는 둘이 어긋나는 것을 막기 위해서다."""
    return URGENT_NOW if severity == "critical" else TODAY


def explain(what: str, impact: str, *, severity: str = "normal") -> Explanation:
    return Explanation(what=what, impact=impact, urgency=urgency_for(severity))


def check_failed_explanation(title: str) -> Explanation:
    """검사 자체를 못 한 위반의 설명. 모른다는 것은 괜찮다는 뜻이 아니다(AGENTS.md 3항)."""
    return explain(
        f"'{title}' 검사를 이번에 하지 못했습니다",
        "이 항목이 지금 괜찮은지 알 수 없습니다. 그 사이 생긴 문제는 알림이 오지 않습니다",
    )
