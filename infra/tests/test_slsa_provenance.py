from __future__ import annotations

import json
from pathlib import Path

import pytest

RELEASE_TAG_REF = "refs/tags/release/v1.4.0"
# annotated tag를 push할 때 GitHub이 ref의 SHA로 무엇을 주는지 문서가 정하지 않는다.
# fixture에서 commit과 tag object를 일부러 다르게 두어야 predicate가 어느 쪽을 쓰는지 검증된다.
RELEASE_COMMIT = "a" * 40
TAG_OBJECT_SHA = "c" * 40
WORKFLOW_REF = f"Lamyzm/eat-bid-service/.github/workflows/build.yml@{RELEASE_TAG_REF}"

VALID_ENV = {
    "EATBID_JOB_WORKFLOW_REF": WORKFLOW_REF,
    "EATBID_RELEASE_COMMIT": RELEASE_COMMIT,
    "EATBID_RELEASE_TAG_OBJECT": TAG_OBJECT_SHA,
    "GITHUB_EVENT_NAME": "push",
    "GITHUB_REPOSITORY": "Lamyzm/eat-bid-service",
    "GITHUB_REPOSITORY_ID": "987654321",
    "GITHUB_REPOSITORY_OWNER_ID": "12345678",
    "GITHUB_SERVER_URL": "https://github.com",
    "GITHUB_REF": RELEASE_TAG_REF,
    "GITHUB_SHA": TAG_OBJECT_SHA,
    "GITHUB_RUN_ID": "123456789",
    "GITHUB_RUN_ATTEMPT": "2",
    "GITHUB_WORKFLOW_REF": WORKFLOW_REF,
    "GITHUB_WORKFLOW_SHA": RELEASE_COMMIT,
    "RUNNER_ENVIRONMENT": "github-hosted",
}


def test_allowlist된_GitHub_env로_결정적_SLSA_v1_predicate를_빌드한다() -> None:
    from infra.generate_slsa_provenance import build_predicate, render_predicate

    environment = {**VALID_ENV, "UNRELATED_SECRET": "must-not-leak"}
    predicate = build_predicate(environment)

    assert predicate == {
        "buildDefinition": {
            "buildType": "https://actions.github.io/buildtypes/workflow/v1",
            "externalParameters": {
                "workflow": {
                    "path": ".github/workflows/build.yml",
                    "ref": RELEASE_TAG_REF,
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
                    "digest": {"gitCommit": RELEASE_COMMIT},
                    "uri": (
                        "git+https://github.com/Lamyzm/eat-bid-service"
                        f"@{RELEASE_TAG_REF}"
                    ),
                }
            ],
        },
        "runDetails": {
            "builder": {
                "id": (
                    "https://github.com/Lamyzm/eat-bid-service/"
                    ".github/workflows/build.yml@"
                    f"{RELEASE_TAG_REF}"
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


def test_SLSA는_release_tag와_peeled_commit을_같은_subject로_사용한다() -> None:
    from infra.generate_slsa_provenance import build_predicate

    predicate = build_predicate(VALID_ENV)
    dependency = predicate["buildDefinition"]["resolvedDependencies"][0]

    assert dependency["uri"].endswith(f"@{RELEASE_TAG_REF}")
    assert dependency["digest"]["gitCommit"] == RELEASE_COMMIT
    assert predicate["buildDefinition"]["externalParameters"]["workflow"]["ref"] == (
        RELEASE_TAG_REF
    )
    # GITHUB_SHA는 tag object일 수 있으므로 provenance 어디에도 들어가면 안 된다.
    assert TAG_OBJECT_SHA not in json.dumps(predicate)


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("GITHUB_REPOSITORY", "missing-slash"),
        ("GITHUB_REPOSITORY", "someone/eat-bid-service"),
        ("GITHUB_SERVER_URL", "http://github.com"),
        ("GITHUB_EVENT_NAME", "pull_request"),
        ("GITHUB_EVENT_NAME", "workflow_dispatch"),
        ("GITHUB_REF", "refs/heads/main"),
        ("GITHUB_REF", "refs/heads/master"),
        ("GITHUB_REF", "refs/tags/v1.4.0"),
        ("GITHUB_REF", "refs/tags/release/v1.4"),
        ("GITHUB_REF", "refs/tags/release/v1.4.0-rc1"),
        ("GITHUB_REF", "refs/tags/release/v1.4.0/extra"),
        ("GITHUB_SHA", "A" * 40),
        ("GITHUB_SHA", "a" * 39),
        ("GITHUB_SHA", "b" * 40),
        ("EATBID_RELEASE_COMMIT", "A" * 40),
        ("EATBID_RELEASE_COMMIT", "a" * 39),
        ("EATBID_RELEASE_TAG_OBJECT", "A" * 40),
        ("EATBID_RELEASE_TAG_OBJECT", "a" * 39),
        ("GITHUB_WORKFLOW_SHA", "b" * 40),
        (
            "GITHUB_WORKFLOW_REF",
            f"Lamyzm/eat-bid-service/.github/workflows/other.yml@{RELEASE_TAG_REF}",
        ),
        (
            "GITHUB_WORKFLOW_REF",
            "Lamyzm/eat-bid-service/.github/workflows/build.yml@refs/heads/main",
        ),
        (
            "EATBID_JOB_WORKFLOW_REF",
            f"Lamyzm/eat-bid-service/.github/workflows/other.yml@{RELEASE_TAG_REF}",
        ),
        ("GITHUB_REPOSITORY_ID", "repo-1"),
        ("GITHUB_REPOSITORY_ID", "0"),
        ("GITHUB_REPOSITORY_OWNER_ID", "owner-1"),
        ("RUNNER_ENVIRONMENT", "self-hosted"),
        ("GITHUB_RUN_ID", "run-1"),
        ("GITHUB_RUN_ATTEMPT", "0"),
    ],
)
def test_신뢰하지_않는_또는_비정규_github_identity을_거부한다(key: str, value: str) -> None:
    from infra.generate_slsa_provenance import ProvenanceError, build_predicate

    with pytest.raises(ProvenanceError):
        build_predicate({**VALID_ENV, key: value})


@pytest.mark.parametrize("missing_key", sorted(VALID_ENV))
def test_누락된_필수_github_identity을_거부한다(missing_key: str) -> None:
    from infra.generate_slsa_provenance import ProvenanceError, build_predicate

    environment = {**VALID_ENV}
    del environment[missing_key]
    with pytest.raises(ProvenanceError):
        build_predicate(environment)


def test_CLI가_정확한_predicate를_기록하고_overwrite를_거부한다(
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


@pytest.mark.parametrize("ref_sha", [RELEASE_COMMIT, TAG_OBJECT_SHA])
def test_ref_SHA가_peel된_commit이든_tag_object든_통과한다(ref_sha: str) -> None:
    from infra.generate_slsa_provenance import build_predicate

    predicate = build_predicate(
        {**VALID_ENV, "GITHUB_SHA": ref_sha, "GITHUB_WORKFLOW_SHA": ref_sha}
    )

    # 어느 규약이 오든 provenance가 기록하는 commit은 peel된 release commit 하나다.
    dependency = predicate["buildDefinition"]["resolvedDependencies"][0]
    assert dependency["digest"]["gitCommit"] == RELEASE_COMMIT
