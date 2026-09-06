from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from conftest import ManifestSet

CLUSTER_SOURCE_RANGE = ["10.42.0.0/16", "172.30.0.0/24"]
MIDDLEWARE_ANNOTATION = "traefik.ingress.kubernetes.io/router.middlewares"


def _paths(ingress: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        path
        for rule in ingress["spec"]["rules"]
        for path in rule["http"]["paths"]
    ]


def test_internal_경로는_ipAllowList_middleware를_붙인_전용_Ingress가_받는다(
    manifests: ManifestSet,
) -> None:
    ingress = manifests.named("Ingress", "web-internal")
    annotations = ingress["metadata"].get("annotations", {})

    assert annotations[MIDDLEWARE_ANNOTATION] == "eatbid-internal-allowlist@kubernetescrd"
    assert _paths(ingress) == [
        {
            "path": "/internal",
            "pathType": "Prefix",
            "backend": {"service": {"name": "web", "port": {"number": 80}}},
        }
    ]


def test_allowlist는_X_Forwarded_For의_원_클라이언트_IP를_판정한다(
    manifests: ManifestSet,
) -> None:
    middleware = manifests.named("Middleware", "internal-allowlist")
    allow_list = middleware["spec"]["ipAllowList"]

    assert allow_list["sourceRange"] == CLUSTER_SOURCE_RANGE
    # cloudflared가 클러스터 안에서 돌기 때문에 remote address는 언제나 pod IP다. depth가 없으면
    # 터널을 통과한 외부 요청이 전부 pod CIDR로 보여 규칙이 아무것도 막지 않는다(ADR 0036-7).
    assert allow_list["ipStrategy"] == {"depth": 1}


def test_internal_경로를_middleware_없이_노출하는_규칙은_없다(
    manifests: ManifestSet,
) -> None:
    for ingress in manifests.of_kind("Ingress"):
        for path in _paths(ingress):
            if not str(path["path"]).startswith("/internal"):
                continue
            annotations = ingress["metadata"].get("annotations", {})
            assert MIDDLEWARE_ANNOTATION in annotations, ingress["metadata"]["name"]

    # `/` catch-all은 그대로 남아 있어야 한다. 이 Ingress는 경로를 옮기는 것이 아니라 middleware를
    # 붙이려고 존재하며, catch-all이 사라지면 화면 전체가 404가 된다.
    catch_all = [
        path
        for ingress in manifests.of_kind("Ingress")
        for path in _paths(ingress)
        if path["path"] == "/"
    ]
    assert catch_all == [
        {
            "path": "/",
            "pathType": "Prefix",
            "backend": {"service": {"name": "web", "port": {"number": 80}}},
        }
    ]


def test_web_pod는_무효화_토큰을_Secret에서만_받는다(manifests: ManifestSet) -> None:
    deployment = manifests.named("Deployment", "web")
    container = deployment["spec"]["template"]["spec"]["containers"][0]
    token = next(
        item for item in container["env"] if item["name"] == "EATBID_CACHE_REVALIDATE_TOKEN"
    )

    assert "value" not in token
    assert token["valueFrom"]["secretKeyRef"] == {
        "name": "eatbid-cache-revalidate",
        "key": "EATBID_CACHE_REVALIDATE_TOKEN",
    }
    # optional을 붙이면 Secret이 없을 때 파드가 조용히 뜬다. 그 상태는 "토큰 없이 열린 표면"과
    # 구분되지 않으므로 시끄럽게 멈추는 쪽을 고정한다.
    assert "optional" not in token["valueFrom"]["secretKeyRef"]
