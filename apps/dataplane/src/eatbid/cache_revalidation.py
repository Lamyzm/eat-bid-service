"""모듈 책임: 발행·mart 활성화 뒤 web 읽기 캐시 무효화를 알리고 그 실패를 발행 실패로 번지지 않게 한다."""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from pydantic import SecretStr

# 경로의 권위는 `packages/contracts`의 web 소유 operation이다. Python은 그 계약을 읽을 수 없으므로
# 여기 한 곳에만 적고, 어긋나면 web이 404를 돌려주며 그 사실이 실패 로그에 남는다(ADR 0036-6).
REVALIDATE_PATH = "/internal/cache/revalidate"

DEFAULT_TIMEOUT_SECONDS = 5.0


@dataclass(frozen=True, slots=True)
class WebCacheTarget:
    """클러스터 내부 web Service와 그 진입점의 Bearer 토큰이다."""

    base_url: str
    token: SecretStr
    timeout_seconds: float = DEFAULT_TIMEOUT_SECONDS

    @property
    def url(self) -> str:
        return f"{self.base_url.rstrip('/')}{REVALIDATE_PATH}"


class CacheRevalidationClient(Protocol):
    def post(
        self,
        url: str,
        *,
        json: Mapping[str, object],
        headers: Mapping[str, str],
        timeout: float,
    ) -> Any: ...


def all_auctions_scope() -> dict[str, object]:
    """발행에 포함된 공고 id 목록은 결과에 없다. 공고 상세는 PK 1행 조회라 통째로 비워도
    재계산이 병목이 아니며, 그 목록을 얻으려고 CLI 결과 스키마를 늘리지 않는다(ADR 0036-4)."""
    return {"allAuctions": True}


def mart_scope(mart_names: Sequence[str]) -> dict[str, object]:
    """다시 만든 mart가 없으면 보낼 범위도 없다. 빈 요청은 web 계약이 400으로 막는다."""
    return {"marts": list(mart_names)} if mart_names else {}


def _log_failure(url: str, *, reason: str, status: int | None = None) -> None:
    # 예외 메시지에는 호스트·자격증명 조각이 섞일 수 있으므로 예외 클래스 이름만 남긴다.
    record: dict[str, object] = {"event": "cache-revalidate-failed", "url": url, "reason": reason}
    if status is not None:
        record["status"] = status
    print(json.dumps(record, sort_keys=True, separators=(",", ":")), file=sys.stderr)


def revalidate_web_cache(
    scope: Mapping[str, object],
    *,
    target: WebCacheTarget | None,
    client: CacheRevalidationClient,
) -> bool:
    """무효화를 알리고 성공 여부만 돌려준다.

    왜 예외를 올리지 않는가: 이 호출은 발행과 활성 전환이 **끝난 뒤에** 일어난다. 여기서 실패를
    올리면 이미 성공한 전환이 실패로 보고되고, 다음 실행이 같은 일을 다시 하려 든다. 파생물은
    stale이 정상 상태이며(ADR 0011) 화면은 `cacheLife` 상한 안에서 스스로 회복한다(ADR 0036-3).
    """
    if target is None or not scope:
        return False
    try:
        response = client.post(
            target.url,
            json=dict(scope),
            headers={
                "authorization": f"Bearer {target.token.get_secret_value()}",
                "content-type": "application/json",
            },
            timeout=target.timeout_seconds,
        )
        status = int(response.status_code)
    except Exception as error:  # noqa: BLE001 - 무효화 실패는 발행 결과를 바꾸지 않는다.
        _log_failure(target.url, reason=type(error).__name__)
        return False
    if status != 204:
        _log_failure(target.url, reason="unexpected-status", status=status)
        return False
    return True
