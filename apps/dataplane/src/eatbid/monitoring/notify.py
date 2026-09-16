"""모듈 책임: 위반을 사람이 읽고 바로 움직일 수 있는 한 덩어리 문구로 만들고 텔레그램으로 보낸다.

왜 한 번에 묶는가: 한 원인이 여러 기대를 깨뜨리므로 위반마다 따로 보내면 같은 사고가 여러 알림으로
쪼개진다. 받는 사람은 그것이 하나의 사고인지 셋인지 알 수 없다(ADR 0046 결정 6).
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC, datetime

import httpx

from .expectations import Violation
from .state import UNOBSERVED, OpenViolation

_TELEGRAM_LIMIT = 4096


def _truncate(text: str) -> str:
    if len(text) <= _TELEGRAM_LIMIT:
        return text
    # 잘렸다는 사실을 남긴다. 조용히 잘리면 마지막 줄이 없는 것인지 잘린 것인지 알 수 없다.
    marker = "\n… (길이 제한으로 잘림)"
    return text[: _TELEGRAM_LIMIT - len(marker)] + marker


def format_message(environment: str, violations: Sequence[Violation]) -> str:
    """새로 열린 위반들을 하나의 문구로 만든다. 각 줄에 대응 문서 위치를 붙인다."""
    header = f"[{environment}] 운영 기대 위반 {len(violations)}건"
    blocks = [
        f"\n\n• {violation.title}\n  {violation.detail}\n  대응: {violation.runbook}"
        for violation in violations
    ]
    return _truncate(header + "".join(blocks))


def format_resolution(environment: str, keys: Sequence[str]) -> str:
    return _truncate(f"[{environment}] 해소됨: " + ", ".join(keys))


def _age_text(first_seen_at: datetime, now: datetime) -> str:
    """사람이 읽는 나이. 하루 미만은 시간, 그 위는 일 단위다 — "5일째"가 이 문구의 존재 이유다."""
    age = now - first_seen_at
    hours = int(age.total_seconds() // 3600)
    if hours < 24:
        return f"{max(hours, 0)}시간째"
    return f"{hours // 24}일째"


def format_repeat(
    environment: str, items: Sequence[OpenViolation], now: datetime
) -> str:
    """미해결 critical 위반을 다시 알린다. 처음 통과 구별되도록 나이를 앞세운다(ADR 0054 결정 1).

    관측 안 된 위반도 그대로 든다. 모른다는 것이 괜찮다는 뜻은 아니다.
    """
    header = f"[{environment}] 미해결 {len(items)}건 (다시 알림)"
    blocks = [
        f"\n\n• {_age_text(parse_instant(item.first_seen_at), now)} {item.title}"
        f"{' — 관측 안 됨' if item.observation == UNOBSERVED else ''}\n  {item.detail}\n  대응: {item.runbook}"
        for item in items
    ]
    return _truncate(header + "".join(blocks))


def format_digest(
    environment: str, items: Sequence[OpenViolation], now: datetime
) -> str:
    """하루 한 번 요약. 첫 통을 놓쳤어도 여기서 본다 — 5일 방치가 하루가 되는 자리다(ADR 0054 결정 1)."""
    if not items:
        return f"[{environment}] 아침 요약: 열린 위반 없음"
    oldest = min(items, key=lambda item: item.first_seen_at)
    header = (
        f"[{environment}] 아침 요약: 열린 위반 {len(items)}건, "
        f"가장 오래된 것 {_age_text(parse_instant(oldest.first_seen_at), now)} ({oldest.key})"
    )
    lines = [
        f"\n• {_age_text(parse_instant(item.first_seen_at), now)} [{item.severity}] {item.key}"
        f"{' — 관측 안 됨' if item.observation == UNOBSERVED else ''}"
        for item in sorted(items, key=lambda item: item.first_seen_at)
    ]
    return _truncate(header + "".join(lines))


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
