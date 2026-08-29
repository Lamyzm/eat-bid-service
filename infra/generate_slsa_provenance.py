"""Generate the deterministic SLSA v1 predicate used by the build workflow."""

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
PROTECTED_REF = "refs/heads/master"

REPOSITORY_PATTERN = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")
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
    server_url = _required(environment, "GITHUB_SERVER_URL")
    git_ref = _required(environment, "GITHUB_REF")
    git_sha = _required(environment, "GITHUB_SHA")
    run_id = _required(environment, "GITHUB_RUN_ID")
    run_attempt = _required(environment, "GITHUB_RUN_ATTEMPT")

    if REPOSITORY_PATTERN.fullmatch(repository) is None:
        raise ProvenanceError("GITHUB_REPOSITORY must be an owner/repository slug")
    if server_url != GITHUB_SERVER_URL:
        raise ProvenanceError(f"GITHUB_SERVER_URL must be {GITHUB_SERVER_URL}")
    if git_ref != PROTECTED_REF:
        raise ProvenanceError(f"GITHUB_REF must be {PROTECTED_REF}")
    if SHA_PATTERN.fullmatch(git_sha) is None:
        raise ProvenanceError("GITHUB_SHA must be exactly 40 lowercase hexadecimal characters")
    if POSITIVE_INTEGER_PATTERN.fullmatch(run_id) is None:
        raise ProvenanceError("GITHUB_RUN_ID must be a positive decimal integer")
    if POSITIVE_INTEGER_PATTERN.fullmatch(run_attempt) is None:
        raise ProvenanceError("GITHUB_RUN_ATTEMPT must be a positive decimal integer")

    repository_url = f"{server_url}/{repository}"
    builder_id = f"{repository_url}/{WORKFLOW_PATH}@{git_ref}"
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
            "internalParameters": {},
            "resolvedDependencies": [
                {
                    "digest": {"gitCommit": git_sha},
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
    parser.add_argument("--output", required=True, type=Path)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        payload = render_predicate(os.environ)
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
