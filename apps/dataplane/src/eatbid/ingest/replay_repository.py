from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

ReplayStatus = Literal["running", "validated", "published", "failed"]

_BUILD_SHA_PATTERN = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True, slots=True)
class ReplayRunState:
    run_id: UUID
    status: ReplayStatus
    parser_version: str
    build_sha: str
    observation_ids: tuple[int, ...]
    publication_id: UUID
    failure_category: str | None = None
    failure_observation_id: int | None = None
    failure_reason: str | None = None


class ReplayRunRepository(Protocol):
    def start_or_load(
        self,
        *,
        run_id: UUID,
        publication_id: UUID,
        observation_ids: tuple[int, ...],
        build_sha: str,
        parser_version: str,
        started_at: datetime,
    ) -> ReplayRunState: ...


def canonical_replay_manifest(observation_ids: tuple[int, ...]) -> tuple[int, ...]:
    if not isinstance(observation_ids, tuple):
        raise TypeError("observation_ids must be a tuple")
    if not observation_ids:
        raise ValueError("observation_ids must not be empty")
    if any(
        isinstance(observation_id, bool)
        or not isinstance(observation_id, int)
        or observation_id < 1
        for observation_id in observation_ids
    ):
        raise ValueError("observation_ids must contain positive integers")
    if len(set(observation_ids)) != len(observation_ids):
        raise ValueError("observation_ids must be unique")
    return tuple(sorted(observation_ids))


def replay_manifest_fingerprint(observation_ids: tuple[int, ...]) -> str:
    canonical = json.dumps(
        canonical_replay_manifest(observation_ids), separators=(",", ":")
    ).encode("ascii")
    return hashlib.sha256(canonical).hexdigest()


def validate_replay_start(
    *,
    run_id: UUID,
    publication_id: UUID,
    observation_ids: tuple[int, ...],
    build_sha: str,
    parser_version: str,
    started_at: datetime,
) -> tuple[int, ...]:
    if not isinstance(run_id, UUID):
        raise TypeError("run_id must be a UUID")
    if not isinstance(publication_id, UUID):
        raise TypeError("publication_id must be a UUID")
    manifest = canonical_replay_manifest(observation_ids)
    if not isinstance(build_sha, str) or _BUILD_SHA_PATTERN.fullmatch(build_sha) is None:
        raise ValueError("build_sha must be a lowercase SHA-256 digest")
    if (
        not isinstance(parser_version, str)
        or not parser_version
        or parser_version.strip() != parser_version
        or len(parser_version) > 128
    ):
        raise ValueError("parser_version must be a nonempty bounded string")
    if not isinstance(started_at, datetime):
        raise TypeError("started_at must be a datetime")
    if started_at.utcoffset() is None:
        raise ValueError("started_at must be timezone-aware")
    return manifest
