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


def _workflow() -> dict[str, object]:
    parsed = yaml.safe_load(_workflow_text())
    assert isinstance(parsed, dict)
    return parsed


def _job(name: str) -> dict[str, object]:
    jobs = _workflow()["jobs"]
    assert isinstance(jobs, dict)
    job = jobs[name]
    assert isinstance(job, dict)
    return job


def _steps(name: str) -> list[dict[str, object]]:
    steps = _job(name)["steps"]
    assert isinstance(steps, list)
    assert all(isinstance(step, dict) for step in steps)
    return steps


def _step_index(steps: list[dict[str, object]], step_id: str) -> int:
    return next(index for index, step in enumerate(steps) if step.get("id") == step_id)


def test_ci_runs_frozen_typescript_python_and_empty_database_gates() -> None:
    workflow = _workflow_text()
    root_package = yaml.safe_load((ROOT / "package.json").read_text(encoding="utf-8"))

    assert "postgres:16-alpine" in workflow
    assert "oven-sh/setup-bun@v2" in workflow
    assert 'bun-version: "1.2.22"' in workflow
    assert (
        "astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9 # v9.0.0"
        in workflow
    )
    assert 'version: "0.12.6"' in workflow
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


def test_context_preflight_fail_closes_before_any_publication_job() -> None:
    test_job = _job("test")
    guard = str(test_job["if"])
    assert guard.strip().startswith("${{")
    assert guard.strip().endswith("}}")
    assert guard.count("${{") == guard.count("}}") == 1
    for required_context in (
        "github.event_name",
        "github.ref",
        "github.repository",
        "github.server_url",
        "github.sha",
        "github.workflow_ref",
        "github.workflow_sha",
        "refs/heads/master",
        "Lamyzm/eat-bid-service",
        "https://github.com",
        ".github/workflows/build.yml",
        "push",
        "workflow_dispatch",
    ):
        assert required_context in guard

    test_steps = _steps("test")
    checkout_index = next(
        index
        for index, step in enumerate(test_steps)
        if step.get("uses") == "actions/checkout@v4"
    )
    preflight_index = _step_index(test_steps, "provenance-preflight")
    assert preflight_index == checkout_index + 1
    preflight = test_steps[preflight_index]
    assert preflight["env"] == {
        "EATBID_JOB_WORKFLOW_REF": "${{ job.workflow_ref }}",
    }
    assert "infra/generate_slsa_provenance.py --check" in str(preflight["run"])

    build_job = _job("build")
    assert build_job["needs"] == "test"
    build_steps = _steps("build")
    provenance_index = _step_index(build_steps, "generate-provenance")
    login_index = _step_index(build_steps, "registry-login")
    publish_index = _step_index(build_steps, "publish")
    assert provenance_index < login_index < publish_index


def test_ci_builds_all_artifacts_from_full_sha_and_promotes_digests() -> None:
    workflow = _workflow_text()
    parsed = _workflow()
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
    assert "${{ steps.publish.outputs.digest }}" in workflow
    assert "infra/update_image_digest.py" in workflow
    assert "infra/product/kustomization.yaml" in workflow
    assert "infra/bump-image.py" not in workflow
    assert "git rev-parse --short" not in workflow


def test_build_scans_attests_signs_and_verifies_before_exporting_digest() -> None:
    job = _job("build")
    assert job["needs"] == "test"
    assert job["permissions"] == {
        "contents": "read",
        "packages": "write",
        "id-token": "write",
    }
    assert "artifact-metadata" not in job["permissions"]
    assert "attestations" not in job["permissions"]

    steps = _steps("build")
    order = [
        "generate-provenance",
        "build-local",
        "scan",
        "sbom",
        "registry-login",
        "publish",
        "setup-cosign",
        "sign",
        "attest-provenance",
        "attest-sbom",
        "verify-signature",
        "verify-provenance",
        "verify-sbom",
        "record",
        "upload-digest",
    ]
    indexes = [_step_index(steps, step_id) for step_id in order]
    assert indexes == sorted(indexes)

    by_id = {step["id"]: step for step in steps if "id" in step}
    build = by_id["build-local"]
    assert build["uses"] == "docker/build-push-action@v6"
    assert build["with"]["load"] is True
    assert build["with"]["push"] is False
    assert build["with"]["tags"] == (
        "${{ env.REGISTRY }}/eatbid-${{ matrix.app }}:${{ github.sha }}"
    )

    scan = by_id["scan"]
    assert scan["uses"] == (
        "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25"
    )
    assert scan["with"]["version"] == "v0.73.0"
    assert scan["with"]["image-ref"] == (
        "${{ env.REGISTRY }}/eatbid-${{ matrix.app }}:${{ github.sha }}"
    )
    assert str(scan["with"]["exit-code"]) == "1"
    assert scan["with"]["severity"] == "HIGH,CRITICAL"
    assert scan["with"].get("ignore-unfixed") in (None, False)

    sbom = by_id["sbom"]
    assert sbom["uses"] == scan["uses"]
    assert sbom["with"]["version"] == "v0.73.0"
    assert sbom["with"]["image-ref"] == scan["with"]["image-ref"]
    assert sbom["with"]["format"] == "spdx-json"
    assert sbom["with"]["skip-setup-trivy"] is True

    publish = str(by_id["publish"]["run"])
    assert "docker push \"$IMAGE_REF\"" in publish
    assert "docker buildx imagetools inspect" in publish
    assert "^sha256:[0-9a-f]{64}$" in publish

    assert not any(str(step.get("uses", "")).startswith("actions/attest@") for step in steps)

    cosign = by_id["setup-cosign"]
    assert cosign["uses"] == (
        "sigstore/cosign-installer@6f9f17788090df1f26f669e9d70d6ae9567deba6"
    )
    assert cosign["with"]["cosign-release"] == "v3.0.6"
    provenance = str(by_id["generate-provenance"]["run"])
    assert "infra/generate_slsa_provenance.py" in provenance
    assert "provenance-${{ matrix.app }}.json" in provenance
    assert by_id["generate-provenance"]["env"] == {
        "EATBID_JOB_WORKFLOW_REF": "${{ job.workflow_ref }}",
    }
    assert "cosign sign --yes \"$IMAGE_NAME@$IMAGE_DIGEST\"" in str(
        by_id["sign"]["run"]
    )
    assert "cosign attest --yes --type slsaprovenance1" in str(
        by_id["attest-provenance"]["run"]
    )
    assert "--predicate \"provenance-${{ matrix.app }}.json\"" in str(
        by_id["attest-provenance"]["run"]
    )
    assert "cosign attest --yes --type spdxjson" in str(by_id["attest-sbom"]["run"])
    assert "--predicate \"sbom-${{ matrix.app }}.spdx.json\"" in str(
        by_id["attest-sbom"]["run"]
    )

    verification_steps = {
        "verify-signature": "cosign verify",
        "verify-provenance": "cosign verify-attestation --type slsaprovenance1",
        "verify-sbom": "cosign verify-attestation --type spdxjson",
    }
    for step_id, command in verification_steps.items():
        verify = str(by_id[step_id]["run"])
        assert command in verify
        assert "https://token.actions.githubusercontent.com" in verify
        assert (
            "https://github.com/${GITHUB_REPOSITORY}/.github/workflows/build.yml@refs/heads/master"
            in verify
        )
        assert "certificate-identity-regexp" not in verify
        assert "\"$IMAGE_NAME@$IMAGE_DIGEST\"" in verify

    record = str(by_id["record"]["run"])
    assert "${{ steps.publish.outputs.digest }}" in record
    assert "^sha256:[0-9a-f]{64}$" in record


def test_promotion_validates_every_matrix_digest_including_migration() -> None:
    job = _job("promote")
    assert job["needs"] == "build"
    steps = _steps("promote")
    pin = next(step for step in steps if step.get("id") == "validate-and-pin")
    command = str(pin["run"])

    assert "for app in web server dataplane migration" in command
    assert "^sha256:[0-9a-f]{64}$" in command
    assert "test -s digests/migration" not in command


def test_product_manifest_has_exactly_the_four_consumed_product_images() -> None:
    manifest = yaml.safe_load(PRODUCT_KUSTOMIZATION.read_text(encoding="utf-8"))
    images = manifest["images"]

    assert manifest["resources"] == ["../k8s/base", "migration.yaml", "workflows"]
    assert {image["name"] for image in images} == {
        "eatbid-web",
        "eatbid-server",
        "eatbid-dataplane",
        "eatbid-migration",
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

    def image_values(value: object) -> list[str]:
        if isinstance(value, dict):
            own = [str(value["image"])] if "image" in value else []
            return own + [
                image
                for child in value.values()
                for image in image_values(child)
            ]
        if isinstance(value, list):
            return [image for child in value for image in image_values(child)]
        return []

    product_images = [
        image
        for document in rendered
        for image in image_values(document)
        if image.startswith("ghcr.io/lamyzm/eatbid-")
    ]

    assert product_images
    assert {
        image.split("@", maxsplit=1)[0].removeprefix("ghcr.io/lamyzm/")
        for image in product_images
    } == {"eatbid-web", "eatbid-server", "eatbid-dataplane", "eatbid-migration"}
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
