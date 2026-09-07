from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.core.build_identity import validate_build_sha
from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.ingest.replay_repository import validate_replay_start
from eatbid.pipeline.replay import (
    ReplayServices,
    canonical_replay_manifest,
    replay_manifest_fingerprint,
    replay_observations,
)

BUILD_SHA = "a" * 64
# 운영 BUILD_SHA는 git commit(40 hex)이며 discover가 그대로 `ingest.run.build_sha`에 넣는다.
RELEASE_COMMIT = "7807b4199929b3ba7df029c39aa7ac82d7d92bc9"
STARTED_AT = datetime(2026, 8, 29, 5, 0, tzinfo=UTC)


@pytest.mark.parametrize("build_sha", [RELEASE_COMMIT, BUILD_SHA])
def test_discover가_받아들인_build_sha를_replay_시작_검증도_받아들인다(build_sha: str) -> None:
    assert validate_build_sha(build_sha) == build_sha

    manifest = validate_replay_start(
        run_id=uuid4(),
        publication_id=uuid4(),
        observation_ids=(3, 1, 2),
        build_sha=build_sha,
        parser_version="eat-v2",
        started_at=STARTED_AT,
    )

    assert manifest == (1, 2, 3)


class RecordingReplayRepository:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

    def start_or_load(self, **kwargs: object):
        self.calls.append(kwargs)
        raise AssertionError("invalid input reached the repository")


class NoDatabaseAccess:
    def __getattribute__(self, name: str):
        raise AssertionError(f"invalid input accessed the database via {name}")


@pytest.mark.parametrize(
    "observation_ids",
    [(), (1, 1), (True,), (False,), (0,), (-1,), ("1",)],
)
def test_replay가_유효하지_않은_manifest에서_모든_repository_write를_사전에_거부한다(
    observation_ids: tuple[object, ...],
) -> None:
    repository = RecordingReplayRepository()
    services = ReplayServices(
        replay_repository=repository,  # type: ignore[arg-type]
        normalization_repository=object(),  # type: ignore[arg-type]
        publication_repository=object(),  # type: ignore[arg-type]
        projection_repository=object(),  # type: ignore[arg-type]
        store=object(),  # type: ignore[arg-type]
    )

    with pytest.raises((TypeError, ValueError)):
        replay_observations(
            run_id=uuid4(),
            publication_id=uuid4(),
            observation_ids=observation_ids,  # type: ignore[arg-type]
            build_sha=BUILD_SHA,
            parser_version="eat-v1",
            started_at=STARTED_AT,
            normalized_at=STARTED_AT + timedelta(minutes=1),
            validated_at=STARTED_AT + timedelta(minutes=2),
            activated_at=STARTED_AT + timedelta(minutes=3),
            services=services,
        )

    assert repository.calls == []


@pytest.mark.parametrize(
    "changes",
    [
        {"run_id": "bad"},
        {"publication_id": "bad"},
        {"observation_ids": ()},
        {"observation_ids": (True,)},
        {"observation_ids": (1, 1)},
        {"build_sha": "bad"},
        {"build_sha": RELEASE_COMMIT[:-1]},
        {"build_sha": RELEASE_COMMIT.upper()},
        {"parser_version": ""},
        {"started_at": STARTED_AT.replace(tzinfo=None)},
    ],
)
def test_postgres_adapter가_runtime_shapes_전에_db_access을_검증한다(
    changes: dict[str, object],
) -> None:
    repository = PsycopgReplayRunRepository(NoDatabaseAccess())  # type: ignore[arg-type]
    arguments: dict[str, object] = {
        "run_id": uuid4(),
        "publication_id": uuid4(),
        "observation_ids": (1,),
        "build_sha": BUILD_SHA,
        "parser_version": "eat-v1",
        "started_at": STARTED_AT,
    }
    arguments.update(changes)

    with pytest.raises((TypeError, ValueError)):
        repository.start_or_load(**arguments)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    "changes",
    [
        {"run_id": "not-a-uuid"},
        {"publication_id": "not-a-uuid"},
        {"build_sha": "A" * 64},
        {"parser_version": ""},
        {"started_at": STARTED_AT.replace(tzinfo=None)},
        {"normalized_at": STARTED_AT - timedelta(seconds=1)},
        {"validated_at": STARTED_AT - timedelta(seconds=1)},
        {"activated_at": STARTED_AT - timedelta(seconds=1)},
    ],
)
def test_replay가_database_접근_전에_유효하지_않은_identity와_chronology를_거부한다(
    changes: dict[str, object],
) -> None:
    repository = RecordingReplayRepository()
    services = ReplayServices(
        replay_repository=repository,  # type: ignore[arg-type]
        normalization_repository=object(),  # type: ignore[arg-type]
        publication_repository=object(),  # type: ignore[arg-type]
        projection_repository=object(),  # type: ignore[arg-type]
        store=object(),  # type: ignore[arg-type]
    )
    arguments: dict[str, object] = {
        "run_id": uuid4(),
        "publication_id": uuid4(),
        "observation_ids": (1,),
        "build_sha": BUILD_SHA,
        "parser_version": "eat-v1",
        "started_at": STARTED_AT,
        "normalized_at": STARTED_AT + timedelta(minutes=1),
        "validated_at": STARTED_AT + timedelta(minutes=2),
        "activated_at": STARTED_AT + timedelta(minutes=3),
        "services": services,
    }
    arguments.update(changes)

    with pytest.raises((TypeError, ValueError)):
        replay_observations(**arguments)  # type: ignore[arg-type]

    assert repository.calls == []


@given(
    st.lists(
        st.integers(min_value=1, max_value=2**31),
        min_size=1,
        max_size=30,
        unique=True,
    )
)
def test_replay_manifest와_fingerprint는_순서에_독립적이다(
    observation_ids: list[int],
) -> None:
    forward = tuple(observation_ids)
    reverse = tuple(reversed(observation_ids))

    assert canonical_replay_manifest(forward) == canonical_replay_manifest(reverse)
    assert replay_manifest_fingerprint(forward) == replay_manifest_fingerprint(reverse)

    changed = forward + (max(observation_ids) + 1,)
    assert replay_manifest_fingerprint(changed) != replay_manifest_fingerprint(forward)
