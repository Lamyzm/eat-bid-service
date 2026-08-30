from pathlib import Path

import yaml


def test_server_uses_distinct_live_and_ready_http_probes_동작을_검증한다() -> None:
    manifest = Path("infra/k8s/base/app.yaml").read_text(encoding="utf-8")
    documents = [document for document in yaml.safe_load_all(manifest) if document]
    server = next(
        document
        for document in documents
        if document.get("kind") == "Deployment"
        and document.get("metadata", {}).get("name") == "server"
    )
    container = server["spec"]["template"]["spec"]["containers"][0]
    assert container["livenessProbe"]["httpGet"]["path"] == "/health/live"
    assert container["readinessProbe"]["httpGet"]["path"] == "/health/ready"
