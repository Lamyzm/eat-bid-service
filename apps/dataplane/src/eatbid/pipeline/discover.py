"""모듈 책임: eaT 목록 page를 raw-first 관측과 봉인된 숫자 ID manifest로 확장한다."""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol
from uuid import UUID

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import (
    ReleaseDatasetPlan,
    ReleaseDatasetProgress,
    SealedSourceRelease,
    SourceReleasePlan,
)
from eatbid.source.client import SourceClient, SourceResponse
from eatbid.source.eat.models import BidListPage
from eatbid.source.eat.normalize import parse_bid_list_page
from eatbid.source.eat.registry import require

_BUILD_SHA = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True, slots=True, kw_only=True)
class DiscoveryPlan:
    source_release_id: UUID
    run_id: UUID
    release_name: str
    as_of: datetime
    build_sha: str
    parser_version: str
    started_at: datetime
    completed_at: datetime
    start_date: str
    end_date: str
    progress_status_code: str
    region_code: str
    page_size: int
    page_budget: int

    def __post_init__(self) -> None:
        if not isinstance(self.source_release_id, UUID) or not isinstance(
            self.run_id, UUID
        ):
            raise TypeError("discovery identities must be UUID values")
        if not self.release_name or not self.parser_version:
            raise ValueError("release_name and parser_version are required")
        if _BUILD_SHA.fullmatch(self.build_sha) is None:
            raise ValueError("build_sha must be a lowercase SHA-256 digest")
        if self.started_at.utcoffset() is None or self.completed_at.utcoffset() is None:
            raise ValueError("discovery timestamps must be timezone-aware")
        if self.as_of.utcoffset() is None or self.completed_at < self.started_at:
            raise ValueError("discovery time range is invalid")
        if isinstance(self.page_size, bool) or not 1 <= self.page_size <= 1_000:
            raise ValueError("page_size must be from 1 through 1000")
        if isinstance(self.page_budget, bool) or not 1 <= self.page_budget <= 10_000:
            raise ValueError("page_budget must be from 1 through 10000")


@dataclass(frozen=True, slots=True)
class DiscoveryResult:
    source_release_id: UUID
    expected_count: int
    external_bid_ids: tuple[str, ...]
    observation_ids: tuple[int, ...]
    manifest_sha256: str


class DiscoveryPersistence(Protocol):
    """왜: use case가 R2·PostgreSQL adapter를 모르면서도 raw-first 순서를 강제한다."""

    def start_run(self, plan: DiscoveryPlan) -> None: ...

    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit: ...

    def archive_observation(
        self, request: CaptureRequest, response: SourceResponse
    ) -> CapturedObservation: ...

    def finalize_run_expected_count(self, run_id: UUID, expected_count: int) -> None: ...

    def plan_release(self, plan: SourceReleasePlan) -> None: ...

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None: ...

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None: ...

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None: ...

    def seal_release(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease: ...

    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None: ...


def discover_release(
    plan: DiscoveryPlan,
    repository: DiscoveryPersistence,
    client: SourceClient,
) -> DiscoveryResult:
    contract = require("bid-list")
    if plan.parser_version != contract.parser_version:
        raise SourceContractError("discovery parser differs from reviewed registry")

    repository.start_run(plan)
    observations: list[CapturedObservation] = []
    source_ids: list[str] = []
    try:
        first = _fetch_page(plan, 1, repository, client)
        observations.append(first[0])
        page = first[1]
        total_count = page.total_count
        required_pages = max(1, math.ceil(total_count / plan.page_size))
        if required_pages > plan.page_budget:
            raise SourceContractError("discovery page budget is insufficient")
        _require_page_size(page.external_bid_ids, 1, required_pages, total_count, plan.page_size)
        source_ids.extend(page.external_bid_ids)

        for page_number in range(2, required_pages + 1):
            observation, current = _fetch_page(
                plan, page_number, repository, client
            )
            observations.append(observation)
            if current.total_count != total_count:
                raise SourceContractError("discovery total count changed between pages")
            _require_page_size(
                current.external_bid_ids,
                page_number,
                required_pages,
                total_count,
                plan.page_size,
            )
            source_ids.extend(current.external_bid_ids)

        if len(source_ids) != total_count:
            raise SourceContractError("discovery row total differs from source count")
        if len(set(source_ids)) != len(source_ids):
            raise SourceContractError("discovery contains duplicate source IDs")
        ordered_ids = tuple(sorted(source_ids, key=int))
        repository.finalize_run_expected_count(plan.run_id, required_pages)
        release_plan = _release_plan(plan, total_count)
        repository.plan_release(release_plan)
        repository.attach_run(plan.source_release_id, plan.run_id)
        for observation in observations:
            repository.attach_observation(
                plan.source_release_id, observation.observation_id
            )
        repository.record_dataset_progress(
            plan.source_release_id,
            ReleaseDatasetProgress(
                dataset=release_plan.datasets[0].dataset,
                observed_count=total_count,
                normalized_count=total_count,
                quarantined_count=0,
            ),
        )
        sealed = repository.seal_release(
            plan.source_release_id, sealed_at=plan.completed_at
        )
        return DiscoveryResult(
            source_release_id=plan.source_release_id,
            expected_count=total_count,
            external_bid_ids=ordered_ids,
            observation_ids=tuple(item.observation_id for item in observations),
            manifest_sha256=sealed.manifest_sha256,
        )
    except Exception as error:
        repository.fail_run(plan, error)
        raise


def _fetch_page(
    plan: DiscoveryPlan,
    page_number: int,
    repository: DiscoveryPersistence,
    client: SourceClient,
) -> tuple[CapturedObservation, BidListPage]:
    planned = repository.plan_page(plan, page_number)
    request = CaptureRequest(
        request_unit_id=planned.request_unit_id,
        run_id=planned.run_id,
        source=planned.source,
        endpoint=planned.endpoint,
        params=planned.params,
    )
    response = client.fetch(request)
    observation = repository.archive_observation(request, response)
    return observation, parse_bid_list_page(response.body)


def _require_page_size(
    source_ids: tuple[str, ...],
    page_number: int,
    required_pages: int,
    total_count: int,
    page_size: int,
) -> None:
    expected = (
        page_size
        if page_number < required_pages
        else total_count - page_size * (required_pages - 1)
    )
    if len(source_ids) != expected:
        raise SourceContractError("discovery page row count is not exact")


def _release_plan(plan: DiscoveryPlan, expected_count: int) -> SourceReleasePlan:
    contract = require("bid-list")
    (dataset,) = contract.response_datasets
    return SourceReleasePlan(
        source_release_id=plan.source_release_id,
        source="eat",
        release_name=plan.release_name,
        as_of=plan.as_of,
        datasets=(
            ReleaseDatasetPlan(
                endpoint=contract.endpoint,
                dataset=dataset,
                record_type=contract.record_type,
                parser_version=contract.parser_version,
                schema_fingerprint=contract.schema_fingerprint,
                expected_count=expected_count,
                observed_count=0,
                normalized_count=0,
                quarantined_count=0,
                required=True,
            ),
        ),
    )
