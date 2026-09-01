"""모듈 책임: source release 저장 port와 canonical manifest 계약을 소유한다."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from hashlib import sha256
from typing import Protocol
from uuid import UUID

from eatbid.ingest.release_models import (
    ReleaseCompleteness,
    ReleaseDatasetProgress,
    ReleaseObservation,
    SealedSourceRelease,
    SourceReleasePlan,
)


class SourceReleaseRepository(Protocol):
    def plan_release(self, plan: SourceReleasePlan) -> None: ...

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None: ...

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None: ...

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None: ...

    def completeness(
        self, source_release_id: UUID
    ) -> tuple[ReleaseCompleteness, ...]: ...

    def seal_release(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease: ...


class SourceReleaseRepositoryError(RuntimeError):
    """source release persistence contract가 거부된 이유를 보존한다."""


class ReleaseNotFoundError(SourceReleaseRepositoryError):
    """요청한 release 또는 dataset identity가 존재하지 않는다."""


class ReleaseSealedError(SourceReleaseRepositoryError):
    """terminal release는 같은 aggregate에서 정정할 수 없다."""


class ReleaseIncompleteError(SourceReleaseRepositoryError):
    """필수 dataset이 exact complete가 아니므로 봉인할 수 없다."""


class ReleaseProgressError(SourceReleaseRepositoryError):
    """dataset progress가 계획된 grain 또는 단조성 계약을 위반했다."""


class ReleaseDuplicateMemberError(SourceReleaseRepositoryError):
    """release member 중복은 조용한 멱등 성공이 아니다."""


class ReleaseManifestConflictError(SourceReleaseRepositoryError):
    """같은 source의 canonical manifest identity가 이미 존재한다."""


class ReleaseIsolationContractError(SourceReleaseRepositoryError):
    """terminal transaction의 top-level READ COMMITTED 계약이 깨졌다."""

    def __init__(self, message: str, *, sqlstate: str = "25000") -> None:
        super().__init__(message)
        self.sqlstate = sqlstate


def canonical_release_manifest(
    plan: SourceReleasePlan,
    observations: tuple[tuple[int, str], ...],
) -> bytes:
    members = tuple(
        ReleaseObservation(observation_id=observation_id, content_sha256=digest)
        for observation_id, digest in observations
    )
    member_ids = [member.observation_id for member in members]
    if len(member_ids) != len(set(member_ids)):
        raise ValueError("observations must be unique by observation_id")
    datasets = sorted(
        (asdict(dataset) for dataset in plan.datasets),
        key=lambda dataset: (
            dataset["dataset"],
            dataset["endpoint"],
            dataset["record_type"],
            dataset["parser_version"],
            dataset["schema_fingerprint"],
        ),
    )
    observation_payload = sorted(
        (asdict(member) for member in members),
        key=lambda member: (member["observation_id"], member["content_sha256"]),
    )
    as_of = plan.as_of.isoformat(timespec="microseconds").replace("+00:00", "Z")
    rendered = json.dumps(
        {
            "source": plan.source,
            "as_of": as_of,
            "datasets": datasets,
            "observations": observation_payload,
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    return rendered.encode("utf-8")


def release_manifest_sha256(
    plan: SourceReleasePlan,
    observations: tuple[tuple[int, str], ...],
) -> str:
    return sha256(canonical_release_manifest(plan, observations)).hexdigest()
