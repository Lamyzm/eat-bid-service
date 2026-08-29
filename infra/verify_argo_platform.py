from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import yaml

ARGO_KINDS = {"CronWorkflow", "WorkflowTemplate"}
Manifest = dict[str, Any]


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


def _one(
    documents: Sequence[Manifest], *, kind: str, name_suffix: str
) -> Manifest:
    matches = [
        document
        for document in documents
        if document.get("kind") == kind and _name(document).endswith(name_suffix)
    ]
    if len(matches) != 1:
        raise ValueError(f"expected one {kind} ending {name_suffix!r}, got {len(matches)}")
    return matches[0]


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

    controller_cluster_bindings = [
        document
        for document in documents
        if document.get("kind") == "ClusterRoleBinding"
        and (
            _component(document) == "workflow-controller"
            or "workflow-controller" in str(document.get("roleRef", {}).get("name", ""))
        )
    ]
    if controller_cluster_bindings:
        raise ValueError("controller ClusterRoleBinding is forbidden in namespaced mode")

    deployments = [
        document
        for document in documents
        if document.get("kind") == "Deployment"
        and _component(document) == "workflow-controller"
    ]
    if len(deployments) != 1:
        raise ValueError(f"expected one workflow controller Deployment, got {len(deployments)}")
    deployment = deployments[0]
    if _metadata(deployment).get("namespace") != namespace:
        raise ValueError("workflow controller is not installed in the product namespace")
    pod_spec = deployment["spec"]["template"]["spec"]
    controller_service_account = str(pod_spec["serviceAccountName"])
    controller = next(
        container
        for container in pod_spec["containers"]
        if container.get("name") == "controller"
    )
    if "--namespaced" not in controller.get("args", []):
        raise ValueError("workflow controller is missing --namespaced")

    controller_role = _one(
        documents, kind="Role", name_suffix="-workflow-controller"
    )
    controller_binding = _one(
        documents, kind="RoleBinding", name_suffix="-workflow-controller"
    )
    if _metadata(controller_role).get("namespace") != namespace:
        raise ValueError("controller Role is not namespaced to eatbid")
    if _metadata(controller_binding).get("namespace") != namespace:
        raise ValueError("controller RoleBinding is not namespaced to eatbid")
    if controller_binding.get("roleRef") != {
        "apiGroup": "rbac.authorization.k8s.io",
        "kind": "Role",
        "name": _name(controller_role),
    }:
        raise ValueError("controller RoleBinding does not bind the namespaced Role")
    controller_subjects = controller_binding.get("subjects", [])
    if not any(
        subject.get("kind") == "ServiceAccount"
        and subject.get("name") == controller_service_account
        and subject.get("namespace") == namespace
        for subject in controller_subjects
    ):
        raise ValueError("controller ServiceAccount is not bound to its namespaced Role")

    workflow_role = _one(documents, kind="Role", name_suffix="-workflow")
    workflow_binding = _one(documents, kind="RoleBinding", name_suffix="-workflow")
    if workflow_binding.get("roleRef", {}).get("name") != _name(workflow_role):
        raise ValueError("workflow executor RoleBinding targets the wrong Role")
    workflow_subjects = workflow_binding.get("subjects", [])
    if workflow_subjects != [{"kind": "ServiceAccount", "name": "eatbid-dataplane"}]:
        raise ValueError("dedicated dataplane ServiceAccount lacks exact executor RBAC")
    workflow_rules = workflow_role.get("rules", [])
    if not any(
        "workflowtaskresults" in rule.get("resources", [])
        and {"create", "patch"}.issubset(rule.get("verbs", []))
        for rule in workflow_rules
    ):
        raise ValueError("workflow executor Role lacks workflowtaskresults permissions")

    cluster_roles = [
        document for document in documents if document.get("kind") == "ClusterRole"
    ]
    cluster_bindings = [
        document
        for document in documents
        if document.get("kind") == "ClusterRoleBinding"
    ]
    if len(cluster_roles) != 1 or _component(cluster_roles[0]) != "crds":
        raise ValueError("only the full-CRD installer may own a ClusterRole")
    if len(cluster_bindings) != 1 or _component(cluster_bindings[0]) != "crds":
        raise ValueError("only the full-CRD installer may own a ClusterRoleBinding")
    if cluster_bindings[0].get("roleRef", {}).get("name") != _name(cluster_roles[0]):
        raise ValueError("full-CRD installer ClusterRoleBinding targets the wrong role")

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
        documents = list(
            yaml.safe_load_all(source_path.read_text(encoding="utf-8"))
        )
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
        yaml.safe_dump(application_values(arguments.application), sys.stdout, sort_keys=False)
    elif arguments.command == "verify":
        verify_chart_render(arguments.rendered, namespace=arguments.namespace)
    else:
        filter_product_workflows(arguments.input)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
