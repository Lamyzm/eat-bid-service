from __future__ import annotations

import json
from pathlib import Path

import pytest

VALID_ENV = {
    "EATBID_JOB_WORKFLOW_REF": (
        "Lamyzm/eat-bid-service/.github/workflows/build.yml@refs/heads/master"
    ),
    "GITHUB_EVENT_NAME": "push",
    "GITHUB_REPOSITORY": "Lamyzm/eat-bid-service",
    "GITHUB_REPOSITORY_ID": "987654321",
    "GITHUB_REPOSITORY_OWNER_ID": "12345678",
    "GITHUB_SERVER_URL": "https://github.com",
    "GITHUB_REF": "refs/heads/master",
    "GITHUB_SHA": "a" * 40,
    "GITHUB_RUN_ID": "123456789",
    "GITHUB_RUN_ATTEMPT": "2",
    "GITHUB_WORKFLOW_REF": (
        "Lamyzm/eat-bid-service/.github/workflows/build.yml@refs/heads/master"
    ),
    "GITHUB_WORKFLOW_SHA": "a" * 40,
    "RUNNER_ENVIRONMENT": "github-hosted",
}


def test_builds_deterministic_slsa_v1_predicate_from_allowlisted_github_env() -> None:
    from infra.generate_slsa_provenance import build_predicate, render_predicate

    environment = {**VALID_ENV, "UNRELATED_SECRET": "must-not-leak"}
    predicate = build_predicate(environment)

    assert predicate == {
        "buildDefinition": {
            "buildType": "https://actions.github.io/buildtypes/workflow/v1",
            "externalParameters": {
                "workflow": {
                    "path": ".github/workflows/build.yml",
                    "ref": "refs/heads/master",
                    "repository": "https://github.com/Lamyzm/eat-bid-service",
                }
            },
            "internalParameters": {
                "github": {
                    "event_name": "push",
                    "repository_id": "987654321",
                    "repository_owner_id": "12345678",
                    "runner_environment": "github-hosted",
                }
            },
            "resolvedDependencies": [
                {
                    "digest": {"gitCommit": "a" * 40},
                    "uri": (
                        "git+https://github.com/Lamyzm/eat-bid-service"
                        "@refs/heads/master"
                    ),
                }
            ],
        },
        "runDetails": {
            "builder": {
                "id": (
                    "https://github.com/Lamyzm/eat-bid-service/"
                    ".github/workflows/build.yml@refs/heads/master"
                )
            },
            "byproducts": [],
            "metadata": {
                "invocationId": (
                    "https://github.com/Lamyzm/eat-bid-service/actions/runs/"
                    "123456789/attempts/2"
                )
            },
        },
    }
    first = render_predicate(environment)
    second = render_predicate(dict(reversed(environment.items())))
    assert first == second
    assert first.endswith(b"\n")
    assert b"must-not-leak" not in first
    assert json.loads(first) == predicate


@pytest.mark.parametrize("event_name", ["push", "workflow_dispatch"])
def test_accepts_only_repository_supported_build_type_events(event_name: str) -> None:
    from infra.generate_slsa_provenance import build_predicate

    predicate = build_predicate({**VALID_ENV, "GITHUB_EVENT_NAME": event_name})
    github_parameters = predicate["buildDefinition"]["internalParameters"]["github"]
    assert github_parameters["event_name"] == event_name


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("GITHUB_REPOSITORY", "missing-slash"),
        ("GITHUB_REPOSITORY", "someone/eat-bid-service"),
        ("GITHUB_SERVER_URL", "http://github.com"),
        ("GITHUB_EVENT_NAME", "pull_request"),
        ("GITHUB_REF", "refs/heads/feature"),
        ("GITHUB_SHA", "A" * 40),
        ("GITHUB_SHA", "a" * 39),
        ("GITHUB_WORKFLOW_SHA", "b" * 40),
        (
            "GITHUB_WORKFLOW_REF",
            "Lamyzm/eat-bid-service/.github/workflows/other.yml@refs/heads/master",
        ),
        (
            "EATBID_JOB_WORKFLOW_REF",
            "Lamyzm/eat-bid-service/.github/workflows/other.yml@refs/heads/master",
        ),
        ("GITHUB_REPOSITORY_ID", "repo-1"),
        ("GITHUB_REPOSITORY_ID", "0"),
        ("GITHUB_REPOSITORY_OWNER_ID", "owner-1"),
        ("RUNNER_ENVIRONMENT", "self-hosted"),
        ("GITHUB_RUN_ID", "run-1"),
        ("GITHUB_RUN_ATTEMPT", "0"),
    ],
)
def test_rejects_untrusted_or_noncanonical_github_identity(key: str, value: str) -> None:
    from infra.generate_slsa_provenance import ProvenanceError, build_predicate

    with pytest.raises(ProvenanceError):
        build_predicate({**VALID_ENV, key: value})


@pytest.mark.parametrize("missing_key", sorted(VALID_ENV))
def test_rejects_missing_required_github_identity(missing_key: str) -> None:
    from infra.generate_slsa_provenance import ProvenanceError, build_predicate

    environment = {**VALID_ENV}
    del environment[missing_key]
    with pytest.raises(ProvenanceError):
        build_predicate(environment)


def test_cli_writes_exact_predicate_and_refuses_overwrite(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from infra.generate_slsa_provenance import main, render_predicate

    for key, value in VALID_ENV.items():
        monkeypatch.setenv(key, value)
    output = tmp_path / "provenance.json"

    assert main(["--check"]) == 0
    assert list(tmp_path.iterdir()) == []
    assert main(["--output", str(output)]) == 0
    assert output.read_bytes() == render_predicate(VALID_ENV)
    assert main(["--output", str(output)]) == 2
    assert output.read_bytes() == render_predicate(VALID_ENV)
