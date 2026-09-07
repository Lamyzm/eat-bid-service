"""모듈 책임: replay run의 port와 시작 인자·고정 manifest 검증을 소유하며 DB 접근 전에 잘못된 정체성을 막는다."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol
from uuid import UUID

from eatbid.core.build_identity import validate_build_sha

ReplayStatus = Literal["running", "validated", "published", "failed"]


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
    validate_processing_start(
        run_id=run_id,
        publication_id=publication_id,
        build_sha=build_sha,
        parser_version=parser_version,
        started_at=started_at,
    )
    return canonical_replay_manifest(observation_ids)


def validate_processing_start(
    *,
    run_id: UUID,
    publication_id: UUID,
    build_sha: str,
    parser_version: str,
    started_at: datetime,
) -> None:
    if not isinstance(run_id, UUID):
        raise TypeError("run_id must be a UUID")
    if not isinstance(publication_id, UUID):
        raise TypeError("publication_id must be a UUID")
    # replay는 `ingest.run.build_sha`에 discover·capture가 넣은 값과 같은 배포 스탬프를 받는다. 여기서
    # 별도 정규식을 두면 운영 BUILD_SHA(git commit 40자)가 replay에서만 CONFIGURATION으로 죽는다.
    validate_build_sha(build_sha)
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
