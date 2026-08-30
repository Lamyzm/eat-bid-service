from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.ingest.postgres_replay_repository import PsycopgReplayRunRepository
from eatbid.pipeline.replay import (
    ReplayServices,
    canonical_replay_manifest,
    replay_manifest_fingerprint,
    replay_observations,
)

BUILD_SHA = "a" * 64
STARTED_AT = datetime(2026, 8, 29, 5, 0, tzinfo=UTC)


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
