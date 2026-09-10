"""모듈 책임: 위반을 사람이 읽고 바로 움직일 수 있는 한 덩어리 문구로 만들고 텔레그램으로 보낸다.

왜 한 번에 묶는가: 한 원인이 여러 기대를 깨뜨리므로 위반마다 따로 보내면 같은 사고가 여러 알림으로
쪼개진다. 받는 사람은 그것이 하나의 사고인지 셋인지 알 수 없다(ADR 0046 결정 6).
"""

from __future__ import annotations

from collections.abc import Sequence

import httpx

from .expectations import Violation

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


def send_telegram(*, token: str, chat_id: str, text: str, timeout_seconds: float = 15.0) -> None:
    """텔레그램으로 보낸다. 실패하면 예외를 올려 workflow가 실패로 끝나게 한다.

    조용히 삼키면 알림이 안 가는 상태가 정상으로 보인다. 이 실패는 클러스터 밖 생존 확인이 받는다.
    """
    response = httpx.post(
        f"https://api.telegram.org/bot{token}/sendMessage",
        json={"chat_id": chat_id, "text": text, "disable_notification": False},
        timeout=timeout_seconds,
    )
    response.raise_for_status()
