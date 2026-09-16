from __future__ import annotations

import re
import subprocess
from pathlib import Path

import yaml

ROOT = Path(__file__).parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "build.yml"
PRODUCT_KUSTOMIZATION = ROOT / "infra" / "envs" / "prod" / "kustomization.yaml"

# publication은 tag push에서만 돌고, tag가 annotated면 github.sha는 commit이 아닐 수 있다.
# 그래서 모든 소비자는 preflight가 peel해 낸 commit 하나만 참조해야 한다.
RELEASE_COMMIT = "${{ needs.preflight.outputs.release_commit }}"
RELEASE_TAG_OBJECT = "${{ needs.preflight.outputs.release_tag_object }}"
RELEASE_TAG_PATTERN = r"^refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+$"
COSIGN_IDENTITY_REGEXP = (
    r"^https://github\.com/Lamyzm/eat-bid-service/"
    r"\.github/workflows/build\.yml@refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+$"
)


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


def _mapping(value: object) -> dict[str, object]:
    assert isinstance(value, dict)
    return value


def _steps(name: str) -> list[dict[str, object]]:
    steps = _job(name)["steps"]
    assert isinstance(steps, list)
    assert all(isinstance(step, dict) for step in steps)
    return steps


def _step_index(steps: list[dict[str, object]], step_id: str) -> int:
    return next(index for index, step in enumerate(steps) if step.get("id") == step_id)


# 삭제 전용 legacy ledger 검사는 고정 기준 commit의 blob을 직접 읽는다. shallow clone에서는 그
# commit이 없어 `git rev-parse`가 죽는다.
LEDGER_READING_COMMANDS = ("pnpm architecture:check", "pnpm quality:check")


def test_ledger를_읽는_job은_전체_이력을_checkout한다() -> None:
    jobs = _mapping(_workflow()["jobs"])
    checked = []
    for name in jobs:
        steps = _steps(name)
        commands = " ".join(str(step.get("run", "")) for step in steps)
        if not any(command in commands for command in LEDGER_READING_COMMANDS):
            continue
        checked.append(name)
        checkout = next(
            step for step in steps if step.get("uses") == "actions/checkout@v4"
        )
        assert _mapping(checkout["with"]) == {
            "ref": RELEASE_COMMIT,
            "fetch-depth": 0,
        }, name

    assert sorted(checked) == ["contract-portability", "test"]


def test_CI가_frozen_TypeScript와_Python_및_empty_database_gate를_실행한다() -> None:
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


def test_CI가_Windows에서_frozen_contract와_semantic_gate를_검증한다() -> None:
    job = _job("contract-portability")
    assert job["runs-on"] == "windows-latest"
    steps = _steps("contract-portability")
    commands = [str(step.get("run", "")) for step in steps]

    frozen_pnpm = next(index for index, command in enumerate(commands) if "pnpm install --frozen-lockfile" in command)
    frozen_uv = next(index for index, command in enumerate(commands) if "uv sync --frozen" in command)
    architecture = next(index for index, command in enumerate(commands) if "pnpm architecture:check" in command)
    mutations = next(index for index, command in enumerate(commands) if "pnpm test:quality" in command)

    assert frozen_pnpm < architecture
    assert frozen_uv < architecture
    assert architecture < mutations
    assert _job("build")["needs"] == ["preflight", "test", "contract-portability"]


def test_CI가_정확한_Argo와_Helm_render_계약을_엄격히_lint한다() -> None:
    steps = _steps("test")
    gate = next(step for step in steps if step.get("id") == "verify-argo-delivery")
    command = str(gate["run"])

    assert (
        "alpine/helm@sha256:a572075a78666ad6fb1f40cb477a9e2eabbc46f3739beeb81904a6121f6ef027"
        in command
    )
    assert "https://argoproj.github.io/argo-helm" in command
    assert "--version 1.0.23" in command
    assert "infra/verify_argo_platform.py" in command
    assert (
        "quay.io/argoproj/argocli@sha256:83e93aa9149a51da998c1df4abea7ae2c504e0b0a5892052dc092740f68323e8"
        in command
    )
    assert "lint --offline --strict" in command
    assert "infra/tests/fixtures/argo-workflows-extra-list.values.yaml" in command
    assert "adversarial-chart.yaml" in command
    assert "List-like Kubernetes documents are forbidden" in command
    assert "kubectl apply" not in command


def _triggers() -> dict[str, object]:
    """YAML 1.1은 `on:` key를 boolean True로 읽으므로 두 표현을 모두 받아준다."""
    parsed = _workflow()
    return _mapping(parsed["on"] if "on" in parsed else parsed[True])


def test_publication은_canonical_release_tag_push에서만_시작한다() -> None:
    triggers = _triggers()

    assert set(triggers) == {"push"}
    assert _mapping(triggers["push"]) == {"tags": ["release/v*"]}

    workflow = _workflow_text()
    assert "workflow_dispatch" not in workflow
    assert "branches:" not in workflow

    # publication을 시작할 수 있는 job은 preflight 하나뿐이고 나머지는 needs로만 열린다.
    jobs = _mapping(_workflow()["jobs"])
    assert [name for name, job in jobs.items() if "if" in _mapping(job)] == ["preflight"]
    for name, job in jobs.items():
        if name != "preflight":
            assert "preflight" in _mapping(job)["needs"], name


def test_context_preflight_실패가_모든_publication_job_전에_실행을_닫는다() -> None:
    guard = str(_job("preflight")["if"])
    assert guard.strip().startswith("${{")
    assert guard.strip().endswith("}}")
    assert guard.count("${{") == guard.count("}}") == 1
    for required_context in (
        "github.event_name",
        "github.ref",
        "github.repository",
        "github.server_url",
        "github.workflow_ref",
        "refs/tags/release/v",
        "Lamyzm/eat-bid-service",
        "https://github.com",
        ".github/workflows/build.yml",
        "push",
    ):
        assert required_context in guard
    for rejected_context in ("workflow_dispatch", "refs/heads/master", "refs/heads/main"):
        assert rejected_context not in guard

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
        "EATBID_RELEASE_COMMIT": RELEASE_COMMIT,
        "EATBID_RELEASE_TAG_OBJECT": RELEASE_TAG_OBJECT,
    }
    assert "infra/generate_slsa_provenance.py --check" in str(preflight["run"])

    build_job = _job("build")
    assert build_job["needs"] == ["preflight", "test", "contract-portability"]
    build_steps = _steps("build")
    provenance_index = _step_index(build_steps, "generate-provenance")
    login_index = _step_index(build_steps, "registry-login")
    publish_index = _step_index(build_steps, "publish")
    assert provenance_index < login_index < publish_index


def test_CI가_full_SHA로_모든_artifact를_빌드하고_digest를_승격한다() -> None:
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
    assert f"GIT_SHA={RELEASE_COMMIT}" in workflow
    assert f"org.opencontainers.image.revision={RELEASE_COMMIT}" in workflow
    assert "${{ github.sha }}" not in workflow
    assert "${{ steps.publish.outputs.digest }}" in workflow
    assert "infra/update_image_digest.py" in workflow
    assert "infra/envs/prod/kustomization.yaml" in workflow
    assert "infra/bump-image.py" not in workflow
    assert "git rev-parse --short" not in workflow


def test_build가_digest_출력_전에_scan_attest_sign_verify를_완료한다() -> None:
    job = _job("build")
    assert job["needs"] == ["preflight", "test", "contract-portability"]
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
        "${{ env.REGISTRY }}/eatbid-${{ matrix.app }}:" + RELEASE_COMMIT
    )

    scan = by_id["scan"]
    assert scan["uses"] == (
        "aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25"
    )
    assert scan["with"]["version"] == "v0.73.0"
    assert scan["with"]["image-ref"] == (
        "${{ env.REGISTRY }}/eatbid-${{ matrix.app }}:" + RELEASE_COMMIT
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
        "EATBID_RELEASE_COMMIT": RELEASE_COMMIT,
        "EATBID_RELEASE_TAG_OBJECT": RELEASE_TAG_OBJECT,
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
        assert COSIGN_IDENTITY_REGEXP in verify
        assert "certificate-identity-regexp" in verify
        assert "refs/heads/master" not in verify
        assert "refs/heads/main" not in verify
        assert "\"$IMAGE_NAME@$IMAGE_DIGEST\"" in verify

    record = str(by_id["record"]["run"])
    assert "${{ steps.publish.outputs.digest }}" in record
    assert "^sha256:[0-9a-f]{64}$" in record


def test_promotion이_migration을_포함한_모든_matrix_digest를_검증한다() -> None:
    job = _job("promote")
    assert job["needs"] == ["preflight", "build"]
    steps = _steps("promote")
    pin = next(step for step in steps if step.get("id") == "validate-and-pin")
    command = str(pin["run"])

    assert "for app in web server dataplane migration" in command
    assert "^sha256:[0-9a-f]{64}$" in command
    assert "test -s digests/migration" not in command


def test_product_manifest는_소비할_product_image_넷을_정확히_갖는다() -> None:
    manifest = yaml.safe_load(PRODUCT_KUSTOMIZATION.read_text(encoding="utf-8"))
    images = manifest["images"]

    # overlay는 base 하나만 참조한다. 여기에 resource를 더하면 그 조각이 한 환경에만 존재하게 되고,
    # 다른 환경에 같은 것을 손으로 복사하지 않으면 두 환경이 조용히 갈라진다.
    assert manifest["resources"] == ["../../base"]
    # db-provisioning의 SQL은 generator로만 실린다. 손으로 쓴 ConfigMap이 끼어들면 저장소 파일과
    # 클러스터 권한이 갈라진다. generator는 base가 소유한다 — 권한 집합은 환경 차이가 아니다.
    base = yaml.safe_load(
        (ROOT / "infra" / "base" / "kustomization.yaml").read_text(encoding="utf-8")
    )
    generators = {generator["name"]: generator for generator in base["configMapGenerator"]}
    assert generators["eatbid-db-provisioning"]["files"] == ["db-provisioning.sql"]
    assert "options" not in generators["eatbid-db-provisioning"]
    # Grafana 대시보드만 이름을 고정한다 — chart가 이름으로 마운트하므로 hash가 붙으면 못 찾는다(EAT-174).
    assert generators["eatbid-grafana-dashboards"]["options"] == {"disableNameSuffixHash": True}
    assert set(generators) == {"eatbid-db-provisioning", "eatbid-grafana-dashboards"}
    assert "configMapGenerator" not in manifest
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


def test_product_render가_product_image에_declared_digest만_사용한다() -> None:
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


def test_pnpm_이미지는_root_prepare_스크립트를_설치_전에_복사한다() -> None:
    # 루트 package의 prepare는 `tools/git/configure-hooks.mjs`를 실행한다. build context에 그 파일이
    # 없으면 `pnpm install` 자체가 모듈을 못 찾아 죽는다. dataplane은 uv를 쓰므로 대상이 아니다.
    for dockerfile in (
        ROOT / "Dockerfile.web",
        ROOT / "Dockerfile.server",
        ROOT / "packages" / "db" / "Dockerfile",
    ):
        lines = dockerfile.read_text(encoding="utf-8").splitlines()
        copy_index = next(
            index for index, line in enumerate(lines) if line.startswith("COPY tools/git ")
        )
        install_index = next(
            index
            for index, line in enumerate(lines)
            if line.startswith("RUN ") and "pnpm install" in line
        )
        assert copy_index < install_index, dockerfile


def test_Dockerfile_넷이_full_SHA_provenance를_포함하고_root를_제거한다() -> None:
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

    assert "pnpm install --frozen-lockfile" in (ROOT / "Dockerfile.web").read_text(encoding="utf-8")
    assert "pnpm install --frozen-lockfile" in (ROOT / "Dockerfile.server").read_text(encoding="utf-8")
    server_dockerfile = (ROOT / "Dockerfile.server").read_text(encoding="utf-8")
    assert "COPY packages/contracts ./packages/contracts" in server_dockerfile
    assert "COPY packages/db ./packages/db" in server_dockerfile
    assert "uv sync --frozen" in (ROOT / "apps" / "dataplane" / "Dockerfile").read_text(encoding="utf-8")
    assert "uv sync --frozen --no-dev --no-editable" in (
        ROOT / "apps" / "dataplane" / "Dockerfile"
    ).read_text(encoding="utf-8")


def test_publication_preflight는_annotated_tag와_current_main_HEAD를_요구한다() -> None:
    job = _job("preflight")
    steps = _steps("preflight")
    resolve = steps[_step_index(steps, "resolve-release-commit")]
    command = str(resolve["run"])

    assert _mapping(job["outputs"]) == {
        "release_commit": "${{ steps.resolve-release-commit.outputs.release_commit }}",
        "release_tag_object": "${{ steps.resolve-release-commit.outputs.release_tag_object }}",
    }
    assert RELEASE_TAG_PATTERN in command
    # actions/checkout이 만드는 local tag ref는 lightweight이므로 annotated 판정에 쓸 수 없다.
    # 원격이 광고하는 ref만 권위이며, peel ref가 함께 오는 tag만 annotated다.
    assert 'git ls-remote origin "$GITHUB_REF" "${GITHUB_REF}^{}" refs/heads/main' in command
    assert 'git cat-file' not in command
    assert "git rev-parse" not in command
    assert "refs/remotes/origin" not in command
    assert 'if [[ -z "$release_commit" ]]; then' in command
    assert "Release tag must be an annotated tag object" in command
    # peel된 commit과 tag object를 둘 다 내야 GitHub의 ref SHA 규약에 의존하지 않는다.
    assert 'echo "release_commit=$release_commit" >> "$GITHUB_OUTPUT"' in command
    assert 'echo "release_tag_object=$release_tag_object" >> "$GITHUB_OUTPUT"' in command
    assert "^[0-9a-f]{40}$" in command


def test_Cosign_검증은_release_tag_workflow_identity에_anchor된다() -> None:
    steps = _steps("build")
    by_id = {step["id"]: step for step in steps if "id" in step}

    for step_id in ("verify-signature", "verify-provenance", "verify-sbom"):
        verify = str(by_id[step_id]["run"])
        assert "--certificate-identity-regexp" in verify
        assert COSIGN_IDENTITY_REGEXP in verify
        assert "--certificate-identity " not in verify
        assert "https://token.actions.githubusercontent.com" in verify

    identity = COSIGN_IDENTITY_REGEXP
    assert re.fullmatch(
        identity,
        "https://github.com/Lamyzm/eat-bid-service/"
        ".github/workflows/build.yml@refs/tags/release/v1.4.0",
    )
    for rejected in (
        (
            "https://github.com/Lamyzm/eat-bid-service/"
            ".github/workflows/build.yml@refs/heads/main"
        ),
        (
            "https://github.com/attacker/eat-bid-service/"
            ".github/workflows/build.yml@refs/tags/release/v1.4.0"
        ),
        (
            "https://github.com/Lamyzm/eat-bid-service/"
            ".github/workflows/release.yml@refs/tags/release/v1.4.0"
        ),
    ):
        assert re.fullmatch(identity, rejected) is None


def test_promotion은_main이_아니라_deploy_prod에_쓰고_guard를_먼저_통과한다() -> None:
    steps = _steps("promote")
    checkout = next(step for step in steps if step.get("uses") == "actions/checkout@v4")
    commands = [str(step.get("run", "")) for step in steps]
    joined = " ".join(commands)

    assert _mapping(checkout["with"])["ref"] == "main"
    guard = next(index for index, command in enumerate(commands) if RELEASE_COMMIT in command and "rev-parse HEAD" in command)
    push = next(index for index, command in enumerate(commands) if "refs/heads/deploy/prod" in command)
    assert guard < push
    # main은 서버가 보호해 pull request만 받는다. 기계가 거기에 쓰는 경로가 남아 있으면 보호가 거짓이 된다.
    assert "HEAD:main" not in joined
    assert "origin main" not in joined
    # deploy/prod는 매 릴리스마다 그 릴리스 commit을 부모로 다시 서므로 fast-forward가 되지 않는다.
    # 기계가 소유한 파생 ref라 강제로 옮기며, 무엇을 옮기는지는 위 guard가 이미 증명했다.
    assert "git push --force origin HEAD:refs/heads/deploy/prod" in joined


def test_cosign_서명과_attest는_OIDC_일시_장애를_세_번까지_다시_시도한다() -> None:
    """v0.1.32 발행이 `fetching ambient OIDC credentials`로 죽었고 재시도가 없어 사람이 다시 돌렸다(EAT-233).
    세 단계 모두 같은 재시도 껍질을 가져야 하고, 마지막 시도 뒤에는 실패로 끝나야 한다."""
    steps = _steps("build")
    for step_id in ("sign", "attest-provenance", "attest-sbom"):
        step = next(step for step in steps if step.get("id") == step_id)
        script = str(step["run"])
        assert "for attempt in 1 2 3" in script, step_id
        assert "cosign" in script, step_id
        assert "sleep 20" in script, step_id
        assert script.rstrip().endswith("exit 1"), step_id

def test_web_Sentry_값_셋은_두_레인_모두_빌드_인자로_들어가고_Dockerfile이_받는다() -> None:
    """Sentry는 빌드 시점 값이라 manifest env로는 켜지지 않는다(EAT-232). 릴리스 레인과 dev 레인이 같은
    repository variables를 넘기고 Dockerfile.web이 그것을 ARG로 받아야 한다. 비어 있으면 꺼진 채 빌드된다."""
    dockerfile = (ROOT / "Dockerfile.web").read_text(encoding="utf-8")
    release = (ROOT / ".github" / "workflows" / "build.yml").read_text(encoding="utf-8")
    dev = (ROOT / ".github" / "workflows" / "dev-image.yml").read_text(encoding="utf-8")

    for name in ("NEXT_PUBLIC_SENTRY_ORG", "NEXT_PUBLIC_SENTRY_PROJECT", "NEXT_PUBLIC_SENTRY_DSN"):
        assert f'ARG {name}=""' in dockerfile, name
        assert f"{name}=${{{{ vars.{name} }}}}" in release, name
        assert f"{name}=${{{{ vars.{name} }}}}" in dev, name
    # 비밀이 아니라 공개 식별자다. secrets로 넘기면 로그에서 가려져 "왜 안 켜졌나"를 볼 수 없다.
    assert "secrets.NEXT_PUBLIC_SENTRY" not in release + dev
