"""모듈 책임: 위반을 사람이 읽고 바로 움직일 수 있는 한 덩어리 문구로 만들고 텔레그램으로 보낸다.

왜 한 번에 묶는가: 한 원인이 여러 기대를 깨뜨리므로 위반마다 따로 보내면 같은 사고가 여러 알림으로
쪼개진다. 받는 사람은 그것이 하나의 사고인지 셋인지 알 수 없다(ADR 0046 결정 6).

왜 사람 말을 앞세우는가: 기대 title과 `key=value` detail을 그대로 실으면 받는 사람이 그것이 화면에 무엇을
뜻하는지 다시 해석해야 했다(2026-09-29, EAT-299). 무슨 일·영향·급함을 먼저 쓰고, 에이전트와 표 조회에 필요한
내부 key·detail은 맨 아래 한 줄로 내린다 — 지우지 않는 이유는 그 줄이 `monitoring.violation`을 찾는 열쇠라서다.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from .expectations import Violation
from .explanation import Explanation, urgency_for
from .state import UNOBSERVED, OpenViolation

_TELEGRAM_LIMIT = 4096


def truncate(text: str) -> str:
    if len(text) <= _TELEGRAM_LIMIT:
        return text
    # 잘렸다는 사실을 남긴다. 조용히 잘리면 마지막 줄이 없는 것인지 잘린 것인지 알 수 없다.
    marker = "\n… (길이 제한으로 잘림)"
    return text[: _TELEGRAM_LIMIT - len(marker)] + marker


def _fallback(title: str, severity: str) -> Explanation:
    # 설명을 들고 오지 않은 위반(검사용 위반, 관측 못 해 표에서 물려받은 위반)은 title로 물러선다. 영향은
    # 지어내지 않는다.
    return Explanation(what=title, impact="확인 못 함", urgency=urgency_for(severity))


def _mark(severity: str) -> str:
    return "❌" if severity == "critical" else "⚠️"


def _block(
    *,
    prefix: str,
    explanation: Explanation,
    severity: str,
    runbook: str,
    key: str,
    detail: str,
) -> str:
    return (
        f"\n\n{_mark(severity)} {prefix}{explanation.what}"
        f"\n영향: {explanation.impact}"
        f"\n급함: {explanation.urgency}"
        f"\n대응: {runbook}"
        f"\n내부: {key} · {detail}"
    )


def format_message(environment: str, violations: Sequence[Violation]) -> str:
    """새로 열린 위반들을 하나의 문구로 만든다. 사람 말 셋과 대응 문서를 앞세우고 내부 정보는 맨 아래다."""
    header = f"[{environment}] 새 문제 {len(violations)}건"
    blocks = [
        _block(
            prefix="",
            explanation=violation.explanation
            or _fallback(violation.title, violation.severity),
            severity=violation.severity,
            runbook=violation.runbook,
            key=violation.key,
            detail=violation.detail,
        )
        for violation in violations
    ]
    return truncate(header + "".join(blocks))


def format_resolution(environment: str, items: Sequence[OpenViolation]) -> str:
    """풀린 위반. 풀린 것은 이전 회차의 표 행이라 설명 대신 기대 이름으로 말한다."""
    lines = "".join(f"\n✅ {item.title or item.key}" for item in items)
    keys = ", ".join(item.key for item in items)
    return truncate(f"[{environment}] 다시 정상 {len(items)}건{lines}\n내부: {keys}")


def age_text(first_seen_at: datetime, now: datetime) -> str:
    """사람이 읽는 나이. 한 시간 미만은 분, 하루 미만은 시간, 그 위는 일 단위다 — "5일째"가 이 문구의 존재 이유다."""
    age = now - first_seen_at
    hours = int(age.total_seconds() // 3600)
    if hours < 1:
        return f"{max(int(age.total_seconds() // 60), 0)}분째"
    if hours < 24:
        return f"{hours}시간째"
    return f"{hours // 24}일째"


def format_repeat(
    environment: str, items: Sequence[OpenViolation], now: datetime
) -> str:
    """미해결 critical 위반을 다시 알린다. 처음 통과 구별되도록 나이를 앞세운다(ADR 0054 결정 1).

    관측 안 된 위반도 그대로 든다. 모른다는 것이 괜찮다는 뜻은 아니다.
    """
    header = f"[{environment}] 아직 안 풀린 문제 {len(items)}건 (다시 알림)"
    blocks = [
        _block(
            prefix=f"{age_text(parse_instant(item.first_seen_at), now)} · "
            + ("(이번엔 확인 못 함) " if item.observation == UNOBSERVED else ""),
            explanation=item.explanation or _fallback(item.title, item.severity),
            severity=item.severity,
            runbook=item.runbook,
            key=item.key,
            detail=item.detail,
        )
        for item in items
    ]
    return truncate(header + "".join(blocks))


def parse_instant(text: str) -> datetime:
    """상태의 ISO 문자열을 aware datetime으로. 옛 문서의 `Z` 표기도 받는다."""
    moment = datetime.fromisoformat(text)
    return moment if moment.tzinfo is not None else moment.replace(tzinfo=UTC)


def send_telegram(
    *, token: str, chat_id: str, text: str, timeout_seconds: float = 15.0
) -> None:
    """텔레그램으로 보낸다. 실패하면 예외를 올려 workflow가 실패로 끝나게 한다.

    조용히 삼키면 알림이 안 가는 상태가 정상으로 보인다. 이 실패는 클러스터 밖 생존 확인이 받는다.
    """
    response = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_notification": False},
        timeout=timeout_seconds,
    )
    response.raise_for_status()
