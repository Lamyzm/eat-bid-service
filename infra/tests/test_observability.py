"""모듈 책임: 관측 화면 셋(OpenObserve·fluent-bit·Grafana)의 platform Application과 base의 내부 Ingress·대시보드가
서로 맞물리고 밖에 열리지 않는 것을 고정한다."""

from __future__ import annotations

import json
import shutil
import subprocess
from typing import Any

import pytest
import yaml
from conftest import MONOREPO_ROOT, ManifestSet

PLATFORM = MONOREPO_ROOT / "infra" / "platform"
DASHBOARD = MONOREPO_ROOT / "infra" / "base" / "observability" / "monitoring-round.json"

APPLICATIONS = {
    "openobserve": ("https://charts.openobserve.ai", "openobserve-standalone", "0.92.2"),
    "fluent-bit": ("https://fluent.github.io/helm-charts", "fluent-bit", "0.58.2"),
    # grafana/helm-charts의 grafana chart는 2026-01-30에 grafana-community로 옮겨졌다. 옛 저장소의 것은
    # deprecated 표시만 남아 있어 거기서 받으면 갱신이 끊긴다.
    "grafana": ("https://grafana-community.github.io/helm-charts", "grafana", "13.2.5"),
}


def _application(name: str) -> dict[str, Any]:
    return yaml.safe_load((PLATFORM / f"{name}.application.yaml").read_text(encoding="utf-8"))


def _values(name: str) -> dict[str, Any]:
    return _application(name)["spec"]["source"]["helm"]["valuesObject"]


@pytest.mark.parametrize("name", sorted(APPLICATIONS))
def test_관측_Application은_chart_version을_박고_eatbid_namespace에_자동_sync_없이_둔다(name: str) -> None:
    """platform 앱은 argo-workflows와 같은 규칙이다 — 버전을 박고, 자동 sync는 없으며(부트스트랩이 손으로
    첫 sync를 건다), 제품과 같은 namespace라 `eatbid-r2`·`eatbid-observability` Secret을 그대로 읽는다."""
    application = _application(name)
    repo, chart, version = APPLICATIONS[name]
    source = application["spec"]["source"]

    assert (source["repoURL"], source["chart"], source["targetRevision"]) == (repo, chart, version)
    assert application["spec"]["destination"]["namespace"] == "eatbid"
    assert "automated" not in application["spec"].get("syncPolicy", {})


def test_OpenObserve는_R2에_쓰고_raw와_접두사를_나누며_UI를_내부_경로에_둔다() -> None:
    values = _values("openobserve")
    config = values["config"]

    assert config["ZO_LOCAL_MODE_STORAGE"] == "s3"
    assert config["ZO_S3_BUCKET_NAME"] == "eatbid-lake"
    assert config["ZO_S3_BUCKET_PREFIX"].startswith("openobserve/")
    assert not config["ZO_S3_BUCKET_PREFIX"].startswith("raw")
    # 자격은 dataplane과 같은 Secret이다. 새 수동 자산을 만들지 않는다(EAT-172와 같은 규칙).
    refs = {env["valueFrom"]["secretKeyRef"]["name"] for env in values["extraEnv"]}
    assert refs == {"eatbid-r2"}
    assert values["auth"]["existingRootUserSecret"]["name"] == "eatbid-observability"
    assert config["ZO_BASE_URI"] == "/internal/o2"
    assert values["ingress"]["enabled"] is False
    assert int(config["ZO_COMPACT_DATA_RETENTION_DAYS"]) <= 30


def test_fluent_bit은_eatbid_파드만_tail해_OpenObserve로_보낸다() -> None:
    values = _values("fluent-bit")
    config = values["config"]

    assert values["kind"] == "DaemonSet"
    assert "Path /var/log/containers/*_eatbid_*.log" in config["inputs"]
    assert "Name systemd" not in config["inputs"]
    assert "Host openobserve" in config["outputs"]
    assert "Port 5080" in config["outputs"]
    # ZO_BASE_URI 아래로 API도 옮겨진다. 루트 /api는 404다.
    assert "URI /internal/o2/api/default/k8s/_json" in config["outputs"]
    # 비밀번호는 config 문자열이 아니라 env 참조다.
    assert "${O2_PASSWORD}" in config["outputs"]
    assert {env["valueFrom"]["secretKeyRef"]["name"] for env in values["env"]} == {"eatbid-observability"}


def test_Grafana는_읽기_역할로_PostgreSQL을_직접_읽고_밖에_열리지_않는다() -> None:
    values = _values("grafana")
    datasource = values["datasources"]["datasources.yaml"]["datasources"][0]

    assert values["admin"]["existingSecret"] == "eatbid-observability"
    assert values["envFromSecret"] == "eatbid-observability"
    assert datasource["type"] == "grafana-postgresql-datasource"
    assert datasource["uid"] == "eatbid-postgres"
    assert datasource["user"] == "eatbid_grafana"
    assert datasource["url"] == "postgres:5432"
    assert datasource["editable"] is False
    # 비밀번호는 provisioning 파일에 적지 않는다.
    assert datasource["secureJsonData"]["password"] == "$GRAFANA_DB_PASSWORD"
    assert values["ingress"]["enabled"] is False
    assert values["grafana.ini"]["server"]["serve_from_sub_path"] is True
    assert values["grafana.ini"]["server"]["root_url"].endswith("/internal/grafana/")
    assert values["grafana.ini"]["users"]["allow_sign_up"] is False
    assert values["dashboardsConfigMaps"] == {"eatbid": "eatbid-grafana-dashboards"}


def test_대시보드는_monitoring_round의_아홉_열을_PostgreSQL_datasource로_그린다() -> None:
    dashboard = json.loads(DASHBOARD.read_text(encoding="utf-8"))
    panels = dashboard["panels"]

    assert dashboard["uid"] == "eatbid-monitoring-round"
    assert dashboard["editable"] is False
    assert len(panels) == 9
    for panel in panels:
        assert panel["datasource"]["uid"] == "eatbid-postgres", panel["title"]
        for target in panel["targets"]:
            assert "monitoring.round" in target["rawSql"], panel["title"]
            assert "$environment" in target["rawSql"], panel["title"]
    columns = (
        "runs_started_1h",
        "runs_failed_1h",
        "auctions_published_1h",
        "open_auctions_now",
        "backfill_windows_incomplete",
        "violations_open",
        "check_duration_ms",
    )
    all_sql = " ".join(target["rawSql"] for panel in panels for target in panel["targets"])
    for column in columns:
        assert column in all_sql, column


def test_base는_대시보드_ConfigMap을_hash_없이_내고_내부_Ingress가_allowlist를_단다(
    prod_manifests: ManifestSet,
) -> None:
    configmap = prod_manifests.named("ConfigMap", "eatbid-grafana-dashboards")
    assert "monitoring-round.json" in configmap["data"]  # type: ignore[operator]

    ingress = prod_manifests.named("Ingress", "observability-internal")
    annotations = ingress["metadata"]["annotations"]  # type: ignore[index]
    assert annotations["traefik.ingress.kubernetes.io/router.middlewares"] == "eatbid-internal-allowlist@kubernetescrd"
    paths = {
        path["path"]: (path["backend"]["service"]["name"], path["backend"]["service"]["port"]["number"])
        for path in ingress["spec"]["rules"][0]["http"]["paths"]  # type: ignore[index]
    }
    assert paths == {"/internal/grafana": ("grafana", 80), "/internal/o2": ("openobserve", 5080)}


def _rendered_services(name: str) -> dict[str, set[int]]:
    application = _application(name)
    source = application["spec"]["source"]
    values = yaml.safe_dump(source["helm"]["valuesObject"], allow_unicode=True)
    result = subprocess.run(
        [
            "helm", "template", name, source["chart"],
            "--repo", source["repoURL"], "--version", source["targetRevision"],
            "--namespace", "eatbid", "--values", "-",
        ],
        input=values,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=True,
    )
    services: dict[str, set[int]] = {}
    for document in yaml.safe_load_all(result.stdout):
        if isinstance(document, dict) and document.get("kind") == "Service":
            ports = {int(port["port"]) for port in document["spec"].get("ports", [])}
            services[document["metadata"]["name"]] = ports
    return services


@pytest.mark.skipif(shutil.which("helm") is None, reason="helm이 없으면 chart를 렌더할 수 없다")
def test_내부_Ingress의_backend는_chart가_실제로_만드는_Service다() -> None:
    """Ingress는 base에 있고 Service는 chart가 만든다. 둘이 어긋나면 화면이 404인데 어느 쪽도 오류를 내지
    않는다. 여기서 chart를 그대로 렌더해 이름과 포트를 대조한다."""
    grafana = _rendered_services("grafana")
    openobserve = _rendered_services("openobserve")

    assert 80 in grafana["grafana"]
    assert 5080 in openobserve["openobserve"]


def test_provisioning은_Grafana_역할을_요구하고_smoke도_같은_역할을_만든다() -> None:
    sql = (MONOREPO_ROOT / "infra" / "base" / "db-provisioning.sql").read_text(encoding="utf-8")
    smoke = (MONOREPO_ROOT / "tools" / "agent-workflow" / "argo-smoke.mjs").read_text(encoding="utf-8")

    assert "'eatbid_grafana'" in sql
    assert '"eatbid_grafana"' in smoke
