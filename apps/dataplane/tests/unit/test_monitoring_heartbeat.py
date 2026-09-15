"""모듈 책임: 심장박동이 정확히 한 번 나가고, 없을 때와 실패할 때가 구분되는지 네트워크 없이 고정한다."""

from __future__ import annotations

from typing import Any

import httpx
import pytest

from eatbid.monitoring.heartbeat import beat

_URL = "https://uptime.example/api/v1/heartbeat/abc"


class _기록하는_GET:
    def __init__(self, status_code: int) -> None:
        self.status_code = status_code
        self.calls: list[tuple[str, float]] = []

    def __call__(self, url: str, *, timeout: float, **_: Any) -> httpx.Response:
        self.calls.append((url, timeout))
        return httpx.Response(self.status_code, request=httpx.Request("GET", url))


def test_URL이_있으면_정확히_한_번_GET하고_sent를_돌려준다() -> None:
    get = _기록하는_GET(200)

    assert beat(_URL, get=get, timeout_seconds=7.0) == "sent"
    assert get.calls == [(_URL, 7.0)]


def test_URL이_없으면_치지_않고_skipped를_돌려준다() -> None:
    # 없는 것과 실패한 것은 다른 사실이다. 수집 파드는 이 값 없이 떠야 한다.
    get = _기록하는_GET(200)

    assert beat(None, get=get) == "skipped"
    assert get.calls == []


@pytest.mark.parametrize("status", [404, 500, 503])
def test_제공자가_거절하면_삼키지_않고_예외로_올린다(status: int) -> None:
    # 조용히 넘기면 제공자가 죽은 동안 안팎이 함께 침묵한다. 예외로 끝내면 안쪽 cron-workflow
    # 기대가 15분 안에 알린다 — EAT-171이 요구한 "제공자 자신의 장애 알림"이다.
    with pytest.raises(httpx.HTTPStatusError):
        beat(_URL, get=_기록하는_GET(status))
