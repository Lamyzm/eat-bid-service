from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from infra.verify_argo_platform import verify_chart_render

ROOT = Path(__file__).parents[2]


def test_verifier_rejects_controller_cluster_wide_rbac(tmp_path: Path) -> None:
    rendered = tmp_path / "rendered.yaml"
    rendered.write_text(
        yaml.safe_dump_all(
            [
                {
                    "apiVersion": "apps/v1",
                    "kind": "Deployment",
                    "metadata": {"name": "controller", "namespace": "eatbid"},
                    "spec": {
                        "template": {
                            "spec": {
                                "serviceAccountName": "controller",
                                "containers": [{"name": "controller", "args": []}],
                            }
                        }
                    },
                },
                {
                    "apiVersion": "rbac.authorization.k8s.io/v1",
                    "kind": "ClusterRoleBinding",
                    "metadata": {
                        "name": "controller",
                        "labels": {"app.kubernetes.io/component": "workflow-controller"},
                    },
                    "roleRef": {"kind": "ClusterRole", "name": "controller"},
                    "subjects": [{"kind": "ServiceAccount", "name": "controller"}],
                },
            ]
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="controller ClusterRoleBinding"):
        verify_chart_render(rendered, namespace="eatbid")
