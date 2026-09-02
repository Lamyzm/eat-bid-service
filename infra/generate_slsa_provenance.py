"""모듈 책임: release tag publication이 신뢰할 수 있는 GitHub identity에서만 시작되는지 판정하고
그 identity로 결정적 SLSA v1 predicate를 만든다."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

WORKFLOW_PATH = ".github/workflows/build.yml"
BUILD_TYPE = "https://actions.github.io/buildtypes/workflow/v1"
GITHUB_SERVER_URL = "https://github.com"
EXPECTED_REPOSITORY = "Lamyzm/eat-bid-service"
# ADR 0024: GitHub Free는 branch를 서버에서 보호하지 못하므로 불변 annotated tag 하나만
# publication 경계로 신뢰한다. branch push와 workflow_dispatch는 여기서 거부한다.
RELEASE_TAG_REF_PATTERN = re.compile(r"refs/tags/release/v[0-9]+\.[0-9]+\.[0-9]+\Z")
SUPPORTED_EVENTS = frozenset({"push"})
TRUSTED_RUNNER_ENVIRONMENT = "github-hosted"

SHA_PATTERN = re.compile(r"[0-9a-f]{40}\Z")
POSITIVE_INTEGER_PATTERN = re.compile(r"[1-9][0-9]*\Z")


class ProvenanceError(ValueError):
    """Raised when trusted workflow identity cannot be proven locally."""


def _required(environment: Mapping[str, object], name: str) -> str:
    value = environment.get(name)
    if not isinstance(value, str) or not value:
        raise ProvenanceError(f"{name} must be a non-empty string")
    return value


def build_predicate(environment: Mapping[str, object]) -> dict[str, object]:
    """Build a SLSA v1 predicate from an allowlist of GitHub-provided values."""

    repository = _required(environment, "GITHUB_REPOSITORY")
    repository_id = _required(environment, "GITHUB_REPOSITORY_ID")
    repository_owner_id = _required(environment, "GITHUB_REPOSITORY_OWNER_ID")
    server_url = _required(environment, "GITHUB_SERVER_URL")
    event_name = _required(environment, "GITHUB_EVENT_NAME")
    git_ref = _required(environment, "GITHUB_REF")
    git_sha = _required(environment, "GITHUB_SHA")
    run_id = _required(environment, "GITHUB_RUN_ID")
    run_attempt = _required(environment, "GITHUB_RUN_ATTEMPT")
    workflow_ref = _required(environment, "GITHUB_WORKFLOW_REF")
    workflow_sha = _required(environment, "GITHUB_WORKFLOW_SHA")
    job_workflow_ref = _required(environment, "EATBID_JOB_WORKFLOW_REF")
    release_commit = _required(environment, "EATBID_RELEASE_COMMIT")
    runner_environment = _required(environment, "RUNNER_ENVIRONMENT")

    if repository != EXPECTED_REPOSITORY:
        raise ProvenanceError(f"GITHUB_REPOSITORY must be {EXPECTED_REPOSITORY}")
    if server_url != GITHUB_SERVER_URL:
        raise ProvenanceError(f"GITHUB_SERVER_URL must be {GITHUB_SERVER_URL}")
    if event_name not in SUPPORTED_EVENTS:
        raise ProvenanceError("GITHUB_EVENT_NAME is not supported by this build workflow")
    if RELEASE_TAG_REF_PATTERN.fullmatch(git_ref) is None:
        raise ProvenanceError("GITHUB_REF must be a canonical release/v<semver> tag ref")
    if SHA_PATTERN.fullmatch(git_sha) is None:
        raise ProvenanceError("GITHUB_SHA must be exactly 40 lowercase hexadecimal characters")
    if SHA_PATTERN.fullmatch(release_commit) is None:
        raise ProvenanceError(
            "EATBID_RELEASE_COMMIT must be exactly 40 lowercase hexadecimal characters"
        )
    # annotated tag를 push하면 GITHUB_SHA는 tag object일 수 있다. workflow 파일을 읽은 commit이
    # tag가 peel되는 commit과 같아야 서명 대상과 소스가 하나로 묶인다.
    if workflow_sha != release_commit:
        raise ProvenanceError("GITHUB_WORKFLOW_SHA must equal EATBID_RELEASE_COMMIT")
    if POSITIVE_INTEGER_PATTERN.fullmatch(repository_id) is None:
        raise ProvenanceError("GITHUB_REPOSITORY_ID must be a positive decimal integer")
    if POSITIVE_INTEGER_PATTERN.fullmatch(repository_owner_id) is None:
        raise ProvenanceError(
            "GITHUB_REPOSITORY_OWNER_ID must be a positive decimal integer"
        )
    if POSITIVE_INTEGER_PATTERN.fullmatch(run_id) is None:
        raise ProvenanceError("GITHUB_RUN_ID must be a positive decimal integer")
    if POSITIVE_INTEGER_PATTERN.fullmatch(run_attempt) is None:
        raise ProvenanceError("GITHUB_RUN_ATTEMPT must be a positive decimal integer")
    if runner_environment != TRUSTED_RUNNER_ENVIRONMENT:
        raise ProvenanceError(
            f"RUNNER_ENVIRONMENT must be {TRUSTED_RUNNER_ENVIRONMENT}"
        )

    expected_workflow_ref = f"{repository}/{WORKFLOW_PATH}@{git_ref}"
    if workflow_ref != expected_workflow_ref:
        raise ProvenanceError("GITHUB_WORKFLOW_REF does not identify the protected workflow")
    if job_workflow_ref != workflow_ref:
        raise ProvenanceError(
            "EATBID_JOB_WORKFLOW_REF must equal the direct GITHUB_WORKFLOW_REF"
        )

    repository_url = f"{server_url}/{repository}"
    builder_id = f"{server_url}/{job_workflow_ref}"
    return {
        "buildDefinition": {
            "buildType": BUILD_TYPE,
            "externalParameters": {
                "workflow": {
                    "path": WORKFLOW_PATH,
                    "ref": git_ref,
                    "repository": repository_url,
                }
            },
            "internalParameters": {
                "github": {
                    "event_name": event_name,
                    "repository_id": repository_id,
                    "repository_owner_id": repository_owner_id,
                    "runner_environment": runner_environment,
                }
            },
            "resolvedDependencies": [
                {
                    "digest": {"gitCommit": release_commit},
                    "uri": f"git+{repository_url}@{git_ref}",
                }
            ],
        },
        "runDetails": {
            "builder": {"id": builder_id},
            "byproducts": [],
            "metadata": {
                "invocationId": (
                    f"{repository_url}/actions/runs/{run_id}/attempts/{run_attempt}"
                )
            },
        },
    }


def render_predicate(environment: Mapping[str, object]) -> bytes:
    """Render canonical, stable JSON without reading any unlisted environment value."""

    return (
        json.dumps(build_predicate(environment), indent=2, sort_keys=True) + "\n"
    ).encode()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    output = parser.add_mutually_exclusive_group(required=True)
    output.add_argument("--check", action="store_true")
    output.add_argument("--output", type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        payload = render_predicate(os.environ)
        if args.check:
            return 0
        if not isinstance(args.output, Path):
            raise ProvenanceError("--output must be a filesystem path")
        with args.output.open("xb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
    except (OSError, ProvenanceError) as error:
        print(f"provenance generation failed: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
