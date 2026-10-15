"""모듈 책임: 파드 안에서 ServiceAccount token으로 Kubernetes API를 부르는 최소 입구(목록·단건 GET, merge patch)를 소유한다.

왜 kubernetes client 패키지를 쓰지 않는가: 필요한 것이 GET 몇 개와 merge patch 하나뿐이라 의존성 하나를 더하는 값이
없다. ServiceAccount token과 CA는 kubelet이 파드 안에 놓아 주며, 그 경로는 Kubernetes가 정한 자리다.

무엇을 할 수 있는지는 이 코드가 아니라 파드에 붙은 ServiceAccount의 RBAC가 정한다. 감시는 읽기 Role만, 자물쇠
풀기는 회차 patch Role만 받는다(EAT-361).
"""

from __future__ import annotations

from collections.abc import Mapping
from pathlib import Path
from typing import Any

import httpx

__all__ = ["InClusterApi"]

_SERVICE_ACCOUNT = Path("/var/run/secrets/kubernetes.io/serviceaccount")
_API = "https://kubernetes.default.svc"


class InClusterApi:
    """파드 안 Kubernetes API다.

    왜 token을 매번 읽는가: projected token은 만료 전에 파일이 갱신된다. 한 번 읽어 두면 오래 사는 프로세스에서
    만료된 token을 계속 보내게 된다 — 감시와 자물쇠 풀기는 짧게 뜨지만 그 가정에 기대지 않는다.
    """

    def __init__(self, *, timeout_seconds: float = 20.0) -> None:
        self._timeout = timeout_seconds

    def _headers(self, content_type: str | None = None) -> dict[str, str]:
        token = (_SERVICE_ACCOUNT / "token").read_text(encoding="utf-8").strip()
        headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
        if content_type is not None:
            headers["Content-Type"] = content_type
        return headers

    def list_items(self, path: str) -> list[Mapping[str, Any]]:
        response = httpx.get(
            f"{_API}{path}",
            headers=self._headers(),
            verify=str(_SERVICE_ACCOUNT / "ca.crt"),
            timeout=self._timeout,
        )
        response.raise_for_status()
        payload = response.json()
        items = payload.get("items") if isinstance(payload, Mapping) else None
        return [item for item in items or () if isinstance(item, Mapping)]

    def get(self, path: str) -> Mapping[str, Any] | None:
        """단건을 읽는다. 없으면(404) None이다 — 이미 지워진 것을 실패로 보지 않는다."""
        response = httpx.get(
            f"{_API}{path}",
            headers=self._headers(),
            verify=str(_SERVICE_ACCOUNT / "ca.crt"),
            timeout=self._timeout,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        payload = response.json()
        return payload if isinstance(payload, Mapping) else None

    def merge_patch(self, path: str, body: Mapping[str, Any]) -> None:
        response = httpx.patch(
            f"{_API}{path}",
            headers=self._headers("application/merge-patch+json"),
            json=dict(body),
            verify=str(_SERVICE_ACCOUNT / "ca.crt"),
            timeout=self._timeout,
        )
        response.raise_for_status()
