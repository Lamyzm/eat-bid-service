from __future__ import annotations

import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "product" / "kustomization.yaml"


def _workflow_text() -> str:
    return WORKFLOW.read_text(encoding="utf-8")


def test_ci_runs_frozen_typescript_python_and_empty_database_gates() -> None:
    workflow = _workflow_text()
    root_package = yaml.safe_load((ROOT / "package.json").read_text(encoding="utf-8"))

    assert "postgres:16-alpine" in workflow
    assert "oven-sh/setup-bun@v2" in workflow
    assert 'bun-version: "1.2.22"' in workflow
    assert "astral-sh/setup-uv@v6" in workflow
    assert "pnpm install --frozen-lockfile" in workflow
    assert "pnpm test" in workflow
    assert "pnpm build" in workflow
    assert "uv sync --frozen" in workflow
    assert "uv run pytest -q" in workflow
    assert "uv run ruff check src tests" in workflow
    assert "uv run pyright src" in workflow
    assert workflow.count("pnpm db:migrate") >= 2
    assert "pnpm db:generate" in workflow
    assert "git diff --exit-code" in workflow
    assert "git status --porcelain --untracked-files=all" in workflow
    assert root_package["scripts"]["db:check"] == "pnpm --filter @eatbid/db db:check"


def test_ci_builds_all_artifacts_from_full_sha_and_promotes_digests() -> None:
    workflow = _workflow_text()
    parsed = yaml.safe_load(workflow)
    includes = parsed["jobs"]["build"]["strategy"]["matrix"]["include"]

    assert {item["app"] for item in includes} == {
        "web",
        "server",
        "dataplane",
        "migration",
    }
    assert all(item["dockerfile"] for item in includes)
    assert all(item["context"] for item in includes)
    assert "GIT_SHA=${{ github.sha }}" in workflow
    assert "org.opencontainers.image.revision=${{ github.sha }}" in workflow
    assert "${{ steps.image.outputs.digest }}" in workflow
    assert "infra/update_image_digest.py" in workflow
    assert "infra/product/kustomization.yaml" in workflow
    assert "infra/bump-image.py" not in workflow
    assert "git rev-parse --short" not in workflow


def test_product_manifest_has_only_the_three_consumed_product_images() -> None:
    manifest = yaml.safe_load(PRODUCT_KUSTOMIZATION.read_text(encoding="utf-8"))
    images = manifest["images"]

    assert manifest["resources"] == ["../k8s/base"]
    assert {image["name"] for image in images} == {
        "eatbid-web",
        "eatbid-server",
        "eatbid-dataplane",
    }
    for image in images:
        assert re.fullmatch(r"sha256:[0-9a-f]{64}", image["digest"])
        assert image["newName"] == f"ghcr.io/lamyzm/{image['name']}"
        assert "newTag" not in image


def test_product_render_uses_only_the_declared_digests_for_product_images() -> None:
    result = subprocess.run(
        ["kubectl", "kustomize", str(PRODUCT_KUSTOMIZATION.parent)],
        capture_output=True,
        check=True,
        text=True,
        encoding="utf-8",
    )
    rendered = list(yaml.safe_load_all(result.stdout))

    product_images: list[str] = []
    for document in rendered:
        if not isinstance(document, dict):
            continue
        workload = document.get("spec", {})
        if document.get("kind") == "CronJob":
            pod_spec = workload["jobTemplate"]["spec"]["template"]["spec"]
        elif document.get("kind") == "Deployment":
            pod_spec = workload["template"]["spec"]
        else:
            continue
        product_images.extend(
            container["image"]
            for container in pod_spec.get("containers", [])
            if container["image"].startswith("ghcr.io/lamyzm/eatbid-")
        )

    assert product_images
    assert {
        image.split("@", maxsplit=1)[0].removeprefix("ghcr.io/lamyzm/")
        for image in product_images
    } == {"eatbid-web", "eatbid-server", "eatbid-dataplane"}
    assert all(
        re.fullmatch(r"ghcr\.io/lamyzm/eatbid-[a-z]+@sha256:[0-9a-f]{64}", image)
        for image in product_images
    )


def test_all_four_dockerfiles_embed_full_sha_provenance_and_drop_root() -> None:
    dockerfiles = [
        ROOT / "Dockerfile.web",
        ROOT / "Dockerfile.server",
        ROOT / "apps" / "dataplane" / "Dockerfile",
        ROOT / "packages" / "db" / "Dockerfile",
    ]

    for dockerfile in dockerfiles:
        text = dockerfile.read_text(encoding="utf-8")
        from_lines = [line for line in text.splitlines() if line.startswith("FROM ")]
        assert from_lines
        assert all(
            re.search(r"@sha256:[0-9a-f]{64}(?:\s+AS\s+\w+)?$", line)
            for line in from_lines
        ), dockerfile
        assert "ARG GIT_SHA" in text, dockerfile
        assert "org.opencontainers.image.revision=$GIT_SHA" in text, dockerfile
        assert "BUILD_SHA=$GIT_SHA" in text, dockerfile
        assert re.search(r"^USER\s+(?!root\b)\S+", text, re.MULTILINE), dockerfile

    assert "pnpm install --frozen-lockfile" in (ROOT / "Dockerfile.web").read_text()
    assert "pnpm install --frozen-lockfile" in (ROOT / "Dockerfile.server").read_text()
    assert "uv sync --frozen" in (ROOT / "apps" / "dataplane" / "Dockerfile").read_text()
    assert "uv sync --frozen --no-dev --no-editable" in (
        ROOT / "apps" / "dataplane" / "Dockerfile"
    ).read_text()
