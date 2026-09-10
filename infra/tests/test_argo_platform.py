from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

from infra.verify_argo_platform import verify_chart_render

MONOREPO_ROOT = Path(__file__).parents[2]

CONTROLLER = "eatbid-argo-workflows-workflow-controller"
EXECUTOR = "eatbid-argo-workflows-workflow"
CRD_INSTALLER = "eatbid-argo-workflows-crd-install"

CONTROLLER_RULES = [
    {
        "apiGroups": [""],
        "resources": ["pods"],
        "verbs": ["create", "get", "list", "watch", "update", "patch", "delete"],
    },
    {"apiGroups": [""], "resources": ["pods/exec"], "verbs": ["create"]},
    {
        "apiGroups": [""],
        "resources": ["configmaps", "namespaces"],
        "verbs": ["get", "watch", "list"],
    },
    {
        "apiGroups": [""],
        "resources": ["persistentvolumeclaims", "persistentvolumeclaims/finalizers"],
        "verbs": ["create", "update", "delete", "get"],
    },
    {
        "apiGroups": ["argoproj.io"],
        "resources": [
            "workflows",
            "workflows/finalizers",
            "workflowtasksets",
            "workflowtasksets/finalizers",
            "workflowtasksets/status",
            "workflowartifactgctasks",
        ],
        "verbs": ["get", "list", "watch", "update", "patch", "delete", "create"],
    },
    {
        "apiGroups": ["argoproj.io"],
        "resources": ["workflowtemplates", "workflowtemplates/finalizers"],
        "verbs": ["get", "list", "watch"],
    },
    {
        "apiGroups": ["argoproj.io"],
        "resources": ["workflowtaskresults", "workflowtaskresults/finalizers"],
        "verbs": ["list", "watch", "deletecollection"],
    },
    {
        "apiGroups": ["argoproj.io"],
        "resources": ["cronworkflows", "cronworkflows/finalizers"],
        "verbs": ["get", "list", "watch", "update", "patch", "delete"],
    },
    {"apiGroups": [""], "resources": ["events"], "verbs": ["create", "patch"]},
    {"apiGroups": [""], "resources": ["serviceaccounts"], "verbs": ["get", "list"]},
    {
        "apiGroups": ["policy"],
        "resources": ["poddisruptionbudgets"],
        "verbs": ["create", "get", "delete"],
    },
    {
        "apiGroups": ["coordination.k8s.io"],
        "resources": ["leases"],
        "verbs": ["create"],
    },
    {
        "apiGroups": ["coordination.k8s.io"],
        "resources": ["leases"],
        "resourceNames": ["workflow-controller", "workflow-controller-lease"],
        "verbs": ["get", "watch", "update", "patch", "delete"],
    },
    {
        "apiGroups": [""],
        "resources": ["secrets"],
        "resourceNames": ["argo-workflows-agent-ca-certificates"],
        "verbs": ["get"],
    },
]


def _role(kind: str, name: str, *, namespace: str | None = None) -> dict[str, Any]:
    metadata: dict[str, Any] = {"name": name}
    if namespace is not None:
        metadata["namespace"] = namespace
    return {
        "apiVersion": "rbac.authorization.k8s.io/v1",
        "kind": kind,
        "metadata": metadata,
    }


def _valid_render() -> list[dict[str, Any]]:
    controller_role = _role("Role", CONTROLLER, namespace="eatbid")
    controller_role["rules"] = deepcopy(CONTROLLER_RULES)
    executor_role = _role("Role", EXECUTOR)
    executor_role["rules"] = [
        {
            "apiGroups": ["argoproj.io"],
            "resources": ["workflowtaskresults"],
            "verbs": ["create", "patch"],
        }
    ]
    crd_role = _role("ClusterRole", CRD_INSTALLER)
    crd_role["metadata"]["labels"] = {"app.kubernetes.io/component": "crds"}
    crd_role["rules"] = [
        {
            "apiGroups": ["apiextensions.k8s.io"],
            "resources": ["customresourcedefinitions"],
            "verbs": ["create", "get", "list", "patch", "update"],
        }
    ]

    controller_binding = _role("RoleBinding", CONTROLLER, namespace="eatbid")
    controller_binding["roleRef"] = {
        "apiGroup": "rbac.authorization.k8s.io",
        "kind": "Role",
        "name": CONTROLLER,
    }
    controller_binding["subjects"] = [
        {"kind": "ServiceAccount", "name": CONTROLLER, "namespace": "eatbid"}
    ]
    executor_binding = _role("RoleBinding", EXECUTOR)
    executor_binding["roleRef"] = {
        "apiGroup": "rbac.authorization.k8s.io",
        "kind": "Role",
        "name": EXECUTOR,
    }
    executor_binding["subjects"] = [
        {"kind": "ServiceAccount", "name": "eatbid-dataplane"}
    ]
    crd_binding = _role("ClusterRoleBinding", CRD_INSTALLER)
    crd_binding["metadata"]["labels"] = {"app.kubernetes.io/component": "crds"}
    crd_binding["roleRef"] = {
        "apiGroup": "rbac.authorization.k8s.io",
        "kind": "ClusterRole",
        "name": CRD_INSTALLER,
    }
    crd_binding["subjects"] = [
        {"kind": "ServiceAccount", "name": CRD_INSTALLER, "namespace": "eatbid"}
    ]
    return [
        {
            "apiVersion": "apps/v1",
            "kind": "Deployment",
            "metadata": {
                "name": CONTROLLER,
                "namespace": "eatbid",
                "labels": {"app.kubernetes.io/component": "workflow-controller"},
            },
            "spec": {
                "template": {
                    "spec": {
                        "serviceAccountName": CONTROLLER,
                        "containers": [
                            {"name": "controller", "args": ["--namespaced"]}
                        ],
                    }
                }
            },
        },
        controller_role,
        executor_role,
        controller_binding,
        executor_binding,
        crd_role,
        crd_binding,
    ]


def _verify(tmp_path: Path, documents: list[dict[str, Any]]) -> None:
    rendered = tmp_path / "rendered.yaml"
    rendered.write_text(yaml.safe_dump_all(documents), encoding="utf-8")
    verify_chart_render(rendered, namespace="eatbid")


def _document(documents: list[dict[str, Any]], kind: str, name: str) -> dict[str, Any]:
    return next(
        document
        for document in documents
        if document.get("kind") == kind
        and document.get("metadata", {}).get("name") == name
    )


def test_정확히_고정한_chart_RBAC_contract를_허용한다(tmp_path: Path) -> None:
    _verify(tmp_path, _valid_render())


@pytest.mark.parametrize(
    "attack",
    [
        "crd-wildcard",
        "crd-extra-controller-subject",
        "crd-role-ref-kind-role",
        "executor-wildcard",
        "executor-role-ref-cluster-role",
        "controller-extra-user",
        "controller-duplicate-subject",
        "extra-dataplane-cluster-admin-binding",
        "unrestricted-controller-secret-get",
        "list-wrapped-dataplane-cluster-admin-binding",
        "role-binding-list-wrapped-cluster-admin-binding",
        "renamed-list-wrapper",
        "crd-aggregation-rule",
    ],
)
def test_RBAC_attack을_거부한다(tmp_path: Path, attack: str) -> None:
    documents = _valid_render()
    if attack == "crd-wildcard":
        _document(documents, "ClusterRole", CRD_INSTALLER)["rules"][0]["verbs"].append(
            "*"
        )
    elif attack == "crd-extra-controller-subject":
        _document(documents, "ClusterRoleBinding", CRD_INSTALLER)["subjects"].append(
            {"kind": "ServiceAccount", "name": CONTROLLER, "namespace": "eatbid"}
        )
    elif attack == "crd-role-ref-kind-role":
        _document(documents, "ClusterRoleBinding", CRD_INSTALLER)["roleRef"]["kind"] = (
            "Role"
        )
    elif attack == "executor-wildcard":
        _document(documents, "Role", EXECUTOR)["rules"][0]["resources"].append("*")
    elif attack == "executor-role-ref-cluster-role":
        _document(documents, "RoleBinding", EXECUTOR)["roleRef"]["kind"] = "ClusterRole"
    elif attack == "controller-extra-user":
        _document(documents, "RoleBinding", CONTROLLER)["subjects"].append(
            {"kind": "User", "name": "attacker"}
        )
    elif attack == "controller-duplicate-subject":
        binding = _document(documents, "RoleBinding", CONTROLLER)
        binding["subjects"].append(deepcopy(binding["subjects"][0]))
    elif attack == "extra-dataplane-cluster-admin-binding":
        binding = _role("RoleBinding", "dataplane-cluster-admin", namespace="eatbid")
        binding["roleRef"] = {
            "apiGroup": "rbac.authorization.k8s.io",
            "kind": "ClusterRole",
            "name": "cluster-admin",
        }
        binding["subjects"] = [{"kind": "ServiceAccount", "name": "eatbid-dataplane"}]
        documents.append(binding)
    elif attack in {
        "list-wrapped-dataplane-cluster-admin-binding",
        "role-binding-list-wrapped-cluster-admin-binding",
        "renamed-list-wrapper",
    }:
        binding = _role("RoleBinding", "dataplane-cluster-admin", namespace="eatbid")
        binding["roleRef"] = {
            "apiGroup": "rbac.authorization.k8s.io",
            "kind": "ClusterRole",
            "name": "cluster-admin",
        }
        binding["subjects"] = [{"kind": "ServiceAccount", "name": "eatbid-dataplane"}]
        documents.append(
            {
                "apiVersion": "v1",
                "kind": (
                    "List"
                    if attack == "list-wrapped-dataplane-cluster-admin-binding"
                    else (
                        "RoleBindingList"
                        if attack == "role-binding-list-wrapped-cluster-admin-binding"
                        else "PrivilegeBundle"
                    )
                ),
                "items": [binding],
            }
        )
    elif attack == "crd-aggregation-rule":
        _document(documents, "ClusterRole", CRD_INSTALLER)["aggregationRule"] = {
            "clusterRoleSelectors": [
                {"matchLabels": {"rbac.eatbid.dev/aggregate": "true"}}
            ]
        }
    else:
        controller = _document(documents, "Role", CONTROLLER)
        secret_rule = next(
            rule for rule in controller["rules"] if rule["resources"] == ["secrets"]
        )
        secret_rule.pop("resourceNames")

    with pytest.raises(ValueError):
        _verify(tmp_path, documents)


def _argo_workflows_values() -> dict[str, Any]:
    application = MONOREPO_ROOT / "infra" / "platform" / "argo-workflows.application.yaml"
    document = yaml.safe_load(application.read_text(encoding="utf-8"))
    return document["spec"]["source"]["helm"]["valuesObject"]


def test_실행_로그는_파드보다_오래_살도록_R2에_보관한다() -> None:
    """왜: podGC와 ttlStrategy가 파드를 지운다. 2026-09-10에는 성공한 백업 회차의 로그를 성공 직후가
    아니면 읽을 수 없었다. 보관을 끄면 사후 진단의 증거가 사라진다(ADR 0046 결정 7, EAT-172)."""
    repository = _argo_workflows_values()["artifactRepository"]

    assert repository["archiveLogs"] is True
    s3 = repository["s3"]
    assert s3["bucket"] == "eatbid-lake"
    assert s3["insecure"] is False
    # 자격은 dataplane이 쓰는 것과 같은 Secret이다. 새 수동 자산을 만들지 않는다.
    assert s3["accessKeySecret"] == {"name": "eatbid-r2", "key": "R2_ACCESS_KEY_ID"}
    assert s3["secretKeySecret"] == {"name": "eatbid-r2", "key": "R2_SECRET_ACCESS_KEY"}


def test_실행_로그_경로는_불변_raw_증거와_섞이지_않는다() -> None:
    """왜: raw는 파서가 틀려도 다시 만들 수 있는 불변 원본이고 실행 로그는 흔적이다. 성질이 다른 둘이
    같은 접두사에 쌓이면 보존 규칙과 삭제 권한을 따로 줄 수 없다(AGENTS.md 1항)."""
    key_format = _argo_workflows_values()["artifactRepository"]["s3"]["keyFormat"]

    assert key_format.startswith("workflow-logs/")
    assert not key_format.startswith("raw/")
    # 회차마다 다른 자리에 쌓여야 뒤 회차가 앞 회차를 덮지 않는다.
    assert "{{workflow.name}}" in key_format and "{{pod.name}}" in key_format
