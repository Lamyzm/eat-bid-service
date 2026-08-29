from __future__ import annotations

import json
from pathlib import Path

import pytest

VALID_ENV = {
    "GITHUB_REPOSITORY": "Lamyzm/eat-bid-service",
    "GITHUB_SERVER_URL": "https://github.com",
    "GITHUB_REF": "refs/heads/master",
    "GITHUB_SHA": "a" * 40,
    "GITHUB_RUN_ID": "123456789",
    "GITHUB_RUN_ATTEMPT": "2",
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
            "internalParameters": {},
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


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("GITHUB_REPOSITORY", "missing-slash"),
        ("GITHUB_SERVER_URL", "http://github.com"),
        ("GITHUB_REF", "refs/heads/feature"),
        ("GITHUB_SHA", "A" * 40),
        ("GITHUB_SHA", "a" * 39),
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

    assert main(["--output", str(output)]) == 0
    assert output.read_bytes() == render_predicate(VALID_ENV)
    assert main(["--output", str(output)]) == 2
    assert output.read_bytes() == render_predicate(VALID_ENV)
