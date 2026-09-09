"""모듈 책임: source release 저장 port와 canonical manifest 계약을 소유한다."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from hashlib import sha256
from typing import Literal, Protocol
from uuid import UUID

from eatbid.ingest.models import PlannedRequestUnit
from eatbid.ingest.release_models import (
    FailedSourceRelease,
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

    def ensure_captured_observation(
        self, source_release_id: UUID, run_id: UUID, observation_id: int
    ) -> None: ...

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None: ...

    def completeness(
        self, source_release_id: UUID
    ) -> tuple[ReleaseCompleteness, ...]: ...

    def require_observation_member(
        self, source_release_id: UUID, observation_id: int
    ) -> None: ...

    def load_preplanned_detail_request(
        self, source_release_id: UUID, run_id: UUID, external_bid_id: str
    ) -> PlannedRequestUnit: ...

    def require_processing_observation(
        self, source_release_id: UUID, run_id: UUID, observation_id: int
    ) -> None: ...

    def require_observation_members(
        self, source_release_id: UUID, observation_ids: tuple[int, ...]
    ) -> None: ...

    def require_publication_corpus(
        self, source_release_id: UUID, run_id: UUID, publication_id: UUID
    ) -> None: ...

    def reconcile_and_seal(
        self, source_release_id: UUID, run_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease: ...

    def require_sealed(self, source_release_id: UUID) -> None: ...

    def seal_release(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease: ...

    def fail_release(
        self, source_release_id: UUID, *, failure_category: str, failed_at: datetime
    ) -> FailedSourceRelease: ...


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


class ReleaseSourceMismatchError(SourceReleaseRepositoryError):
    """release source와 observation source가 다른 membership을 거부한다."""

    def __init__(self, *, release_source: str, observation_source: str) -> None:
        super().__init__("observation source differs from source release")
        self.release_source = release_source
        self.observation_source = observation_source


class ReleaseObservationMembershipError(SourceReleaseRepositoryError):
    """downstream stage는 명시한 source release의 raw member만 처리한다."""


class ReleaseMissingMemberError(SourceReleaseRepositoryError):
    """존재하지 않는 run 또는 observation member를 구분해 보존한다."""

    def __init__(
        self,
        member_kind: Literal["run", "observation"],
        member_id: UUID | int,
    ) -> None:
        if member_kind == "run" and not isinstance(member_id, UUID):
            raise TypeError("run member_id must be a UUID")
        if member_kind == "observation" and (
            isinstance(member_id, bool)
            or not isinstance(member_id, int)
            or member_id < 1
        ):
            raise ValueError("observation member_id must be a positive integer")
        super().__init__(
            f"source release {member_kind} member {member_id} does not exist"
        )
        self.member_kind = member_kind
        self.member_id = member_id


class ReleasePlanConflictError(SourceReleaseRepositoryError):
    """release 계획 identity와 사람이 읽는 이름 충돌을 member 중복과 분리한다."""

    def __init__(
        self,
        conflict_kind: Literal["source_release_id", "source_release_name"],
    ) -> None:
        super().__init__(f"source release plan conflicts by {conflict_kind}")
        self.conflict_kind = conflict_kind


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
