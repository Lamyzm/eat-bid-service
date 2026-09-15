from pathlib import Path

import yaml

MONOREPO_ROOT = Path(__file__).resolve().parents[2]
WEB_APP_DIRECTORY = MONOREPO_ROOT / "apps" / "web" / "src" / "app"


def _deployment_container(name: str) -> dict:
    manifest = (MONOREPO_ROOT / "infra" / "base" / "app.yaml").read_text(encoding="utf-8")
    documents = [document for document in yaml.safe_load_all(manifest) if document]
    deployment = next(
        document
        for document in documents
        if document.get("kind") == "Deployment"
        and document.get("metadata", {}).get("name") == name
    )
    return deployment["spec"]["template"]["spec"]["containers"][0]


def _static_web_routes() -> set[str]:
    """Next app 파일시스템의 정적 page 라우트. 라우트 그룹 `(…)`은 URL에 나타나지 않고 `[…]` 동적
    세그먼트는 probe가 찌를 고정 경로가 아니므로 뺀다."""
    routes: set[str] = set()
    for page in WEB_APP_DIRECTORY.rglob("page.tsx"):
        segments = page.relative_to(WEB_APP_DIRECTORY).parent.parts
        if any(segment.startswith("[") for segment in segments):
            continue
        visible = [segment for segment in segments if not segment.startswith("(")]
        routes.add("/" + "/".join(visible) if visible else "/")
    return routes


def test_server가_서로_다른_live와_ready_HTTP_probe를_사용한다() -> None:
    container = _deployment_container("server")
    assert container["livenessProbe"]["httpGet"]["path"] == "/health/live"
    assert container["readinessProbe"]["httpGet"]["path"] == "/health/ready"


def test_web_readiness_probe는_실제_Next_page_라우트를_가리킨다() -> None:
    # 라우트를 지우면 파드가 영영 Ready가 안 되는데 원인이 diff에 안 보인다. 2026-09-09에
    # `/dashboard/today`가 그렇게 사라졌다(EAT-126). probe 경로는 파일시스템이 아는 정적 라우트여야 한다.
    container = _deployment_container("web")
    probe_path = container["readinessProbe"]["httpGet"]["path"]
    routes = _static_web_routes()
    assert "/today" in routes, routes
    assert probe_path in routes, (probe_path, sorted(routes))
