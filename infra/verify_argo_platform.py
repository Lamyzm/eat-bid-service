from __future__ import annotations

import argparse
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

ARGO_KINDS = {"CronWorkflow", "WorkflowTemplate"}
RBAC_API_VERSION = "rbac.authorization.k8s.io/v1"
RBAC_KINDS = {"Role", "RoleBinding", "ClusterRole", "ClusterRoleBinding"}
CONTROLLER = "eatbid-argo-workflows-workflow-controller"
EXECUTOR = "eatbid-argo-workflows-workflow"
CRD_INSTALLER = "eatbid-argo-workflows-crd-install"
RULE_KEYS = {"apiGroups", "resources", "verbs", "resourceNames"}
Manifest = dict[str, Any]


def _rule(
    api_groups: Sequence[str],
    resources: Sequence[str],
    verbs: Sequence[str],
    resource_names: Sequence[str] = (),
) -> tuple[tuple[str, ...], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    return (
        tuple(sorted(api_groups)),
        tuple(sorted(resources)),
        tuple(sorted(verbs)),
        tuple(sorted(resource_names)),
    )


CONTROLLER_RULES = (
    _rule(
        [""], ["pods"], ["create", "get", "list", "watch", "update", "patch", "delete"]
    ),
    _rule([""], ["pods/exec"], ["create"]),
    _rule([""], ["configmaps", "namespaces"], ["get", "watch", "list"]),
    _rule(
        [""],
        ["persistentvolumeclaims", "persistentvolumeclaims/finalizers"],
        ["create", "update", "delete", "get"],
    ),
    _rule(
        ["argoproj.io"],
        [
            "workflows",
            "workflows/finalizers",
            "workflowtasksets",
            "workflowtasksets/finalizers",
            "workflowtasksets/status",
            "workflowartifactgctasks",
        ],
        ["get", "list", "watch", "update", "patch", "delete", "create"],
    ),
    _rule(
        ["argoproj.io"],
        ["workflowtemplates", "workflowtemplates/finalizers"],
        ["get", "list", "watch"],
    ),
    _rule(
        ["argoproj.io"],
        ["workflowtaskresults", "workflowtaskresults/finalizers"],
        ["list", "watch", "deletecollection"],
    ),
    _rule(
        ["argoproj.io"],
        ["cronworkflows", "cronworkflows/finalizers"],
        ["get", "list", "watch", "update", "patch", "delete"],
    ),
    _rule([""], ["events"], ["create", "patch"]),
    _rule([""], ["serviceaccounts"], ["get", "list"]),
    _rule(["policy"], ["poddisruptionbudgets"], ["create", "get", "delete"]),
    _rule(["coordination.k8s.io"], ["leases"], ["create"]),
    _rule(
        ["coordination.k8s.io"],
        ["leases"],
        ["get", "watch", "update", "patch", "delete"],
        ["workflow-controller", "workflow-controller-lease"],
    ),
    _rule(
        [""],
        ["secrets"],
        ["get"],
        ["argo-workflows-agent-ca-certificates"],
    ),
)
EXECUTOR_RULES = (_rule(["argoproj.io"], ["workflowtaskresults"], ["create", "patch"]),)
CRD_INSTALLER_RULES = (
    _rule(
        ["apiextensions.k8s.io"],
        ["customresourcedefinitions"],
        ["create", "get", "list", "patch", "update"],
    ),
)


def _documents(path: Path) -> tuple[Manifest, ...]:
    return tuple(
        document
        for document in yaml.safe_load_all(path.read_text(encoding="utf-8"))
        if isinstance(document, dict)
    )


def _metadata(document: Mapping[str, Any]) -> Mapping[str, Any]:
    metadata = document.get("metadata")
    if not isinstance(metadata, Mapping):
        raise TypeError(f"{document.get('kind')} is missing metadata")
    return metadata


def _name(document: Mapping[str, Any]) -> str:
    return str(_metadata(document).get("name", ""))


def _labels(document: Mapping[str, Any]) -> Mapping[str, Any]:
    labels = _metadata(document).get("labels", {})
    return labels if isinstance(labels, Mapping) else {}


def _component(document: Mapping[str, Any]) -> str:
    return str(_labels(document).get("app.kubernetes.io/component", ""))


def _list_of_strings(
    value: object, *, field: str, allow_empty: bool = False
) -> tuple[str, ...]:
    if not isinstance(value, list) or (not value and not allow_empty):
        raise ValueError(f"RBAC {field} must be a non-empty list")
    if not all(isinstance(item, str) for item in value):
        raise ValueError(f"RBAC {field} must contain only strings")
    if "*" in value:
        raise ValueError(f"RBAC wildcard is forbidden in {field}")
    return tuple(sorted(value))


def _normalize_rules(document: Mapping[str, Any]) -> tuple[object, ...]:
    rules = document.get("rules")
    if not isinstance(rules, list) or not rules:
        raise ValueError(f"{document.get('kind')} {_name(document)!r} has no rules")
    normalized: list[object] = []
    for rule in rules:
        if not isinstance(rule, Mapping) or set(rule) - RULE_KEYS:
            raise ValueError(f"{_name(document)!r} has an unexpected RBAC rule shape")
        resource_names = rule.get("resourceNames", [])
        normalized.append(
            (
                _list_of_strings(
                    rule.get("apiGroups"), field="apiGroups", allow_empty=True
                ),
                _list_of_strings(rule.get("resources"), field="resources"),
                _list_of_strings(rule.get("verbs"), field="verbs"),
                _list_of_strings(
                    resource_names,
                    field="resourceNames",
                    allow_empty="resourceNames" not in rule,
                ),
            )
        )
    return tuple(sorted(normalized))


def _assert_exact_mapping(
    actual: object, expected: Mapping[str, Any], *, field: str
) -> None:
    if actual != expected:
        raise ValueError(f"unexpected {field}: {actual!r}")


def _verify_exact_rbac(documents: Sequence[Manifest], *, namespace: str) -> None:
    rbac = [document for document in documents if document.get("kind") in RBAC_KINDS]
    identities = [
        (
            str(document.get("kind", "")),
            _name(document),
            _metadata(document).get("namespace"),
        )
        for document in rbac
    ]
    expected_identities = [
        ("Role", CONTROLLER, namespace),
        ("Role", EXECUTOR, None),
        ("RoleBinding", CONTROLLER, namespace),
        ("RoleBinding", EXECUTOR, None),
        ("ClusterRole", CRD_INSTALLER, None),
        ("ClusterRoleBinding", CRD_INSTALLER, None),
    ]
    if Counter(identities) != Counter(expected_identities):
        raise ValueError(f"unexpected rendered RBAC object set: {identities!r}")

    by_identity = {
        identity: document for identity, document in zip(identities, rbac, strict=True)
    }
    if len(by_identity) != len(expected_identities):
        raise ValueError("duplicate rendered RBAC identity")
    for document in rbac:
        if document.get("apiVersion") != RBAC_API_VERSION:
            raise ValueError(f"{_name(document)!r} has unexpected RBAC apiVersion")

    controller_role = by_identity[("Role", CONTROLLER, namespace)]
    executor_role = by_identity[("Role", EXECUTOR, None)]
    crd_role = by_identity[("ClusterRole", CRD_INSTALLER, None)]
    expected_rules = {
        CONTROLLER: tuple(sorted(CONTROLLER_RULES)),
        EXECUTOR: tuple(sorted(EXECUTOR_RULES)),
        CRD_INSTALLER: tuple(sorted(CRD_INSTALLER_RULES)),
    }
    for role in (controller_role, executor_role, crd_role):
        if _normalize_rules(role) != expected_rules[_name(role)]:
            raise ValueError(
                f"{_name(role)!r} does not match the pinned exact RBAC rules"
            )

    bindings = (
        (
            by_identity[("RoleBinding", CONTROLLER, namespace)],
            {
                "apiGroup": "rbac.authorization.k8s.io",
                "kind": "Role",
                "name": CONTROLLER,
            },
            [{"kind": "ServiceAccount", "name": CONTROLLER, "namespace": namespace}],
        ),
        (
            by_identity[("RoleBinding", EXECUTOR, None)],
            {"apiGroup": "rbac.authorization.k8s.io", "kind": "Role", "name": EXECUTOR},
            [{"kind": "ServiceAccount", "name": "eatbid-dataplane"}],
        ),
        (
            by_identity[("ClusterRoleBinding", CRD_INSTALLER, None)],
            {
                "apiGroup": "rbac.authorization.k8s.io",
                "kind": "ClusterRole",
                "name": CRD_INSTALLER,
            },
            [{"kind": "ServiceAccount", "name": CRD_INSTALLER, "namespace": namespace}],
        ),
    )
    for binding, role_ref, subjects in bindings:
        _assert_exact_mapping(binding.get("roleRef"), role_ref, field="roleRef")
        if binding.get("subjects") != subjects:
            raise ValueError(f"{_name(binding)!r} has unexpected or duplicate subjects")


def application_values(application_path: Path) -> Manifest:
    application = yaml.safe_load(application_path.read_text(encoding="utf-8"))
    if not isinstance(application, dict):
        raise TypeError("platform Application must be a mapping")
    try:
        values = application["spec"]["source"]["helm"]["valuesObject"]
    except (KeyError, TypeError) as error:
        raise ValueError("platform Application has no Helm valuesObject") from error
    if not isinstance(values, dict):
        raise TypeError("Helm valuesObject must be a mapping")
    return values


def verify_chart_render(rendered_path: Path, *, namespace: str) -> None:
    documents = _documents(rendered_path)

    _verify_exact_rbac(documents, namespace=namespace)

    deployments = [
        document
        for document in documents
        if document.get("kind") == "Deployment"
        and _component(document) == "workflow-controller"
    ]
    if len(deployments) != 1:
        raise ValueError(
            f"expected one workflow controller Deployment, got {len(deployments)}"
        )
    deployment = deployments[0]
    if _metadata(deployment).get("namespace") != namespace:
        raise ValueError(
            "workflow controller is not installed in the product namespace"
        )
    pod_spec = deployment["spec"]["template"]["spec"]
    controller_service_account = str(pod_spec["serviceAccountName"])
    controller = next(
        container
        for container in pod_spec["containers"]
        if container.get("name") == "controller"
    )
    if "--namespaced" not in controller.get("args", []):
        raise ValueError("workflow controller is missing --namespaced")

    if controller_service_account != CONTROLLER:
        raise ValueError("controller Deployment uses an unexpected ServiceAccount")

    if any(
        document.get("kind") == "Deployment" and _component(document) == "server"
        for document in documents
    ):
        raise ValueError("Argo Server must remain disabled")


def filter_product_workflows(
    source_path: Path | None = None, destination: object = sys.stdout
) -> None:
    if source_path is None:
        documents = list(yaml.safe_load_all(sys.stdin))
    else:
        documents = list(yaml.safe_load_all(source_path.read_text(encoding="utf-8")))
    documents = [
        document
        for document in documents
        if isinstance(document, dict) and document.get("kind") in ARGO_KINDS
    ]
    yaml.safe_dump_all(documents, destination, sort_keys=False)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    values = subcommands.add_parser("values")
    values.add_argument("application", type=Path)
    verify = subcommands.add_parser("verify")
    verify.add_argument("rendered", type=Path)
    verify.add_argument("--namespace", required=True)
    filter_workflows = subcommands.add_parser("filter-workflows")
    filter_workflows.add_argument("--input", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    if arguments.command == "values":
        yaml.safe_dump(
            application_values(arguments.application), sys.stdout, sort_keys=False
        )
    elif arguments.command == "verify":
        verify_chart_render(arguments.rendered, namespace=arguments.namespace)
    else:
        filter_product_workflows(arguments.input)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
