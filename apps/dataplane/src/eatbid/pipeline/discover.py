"""모듈 책임: eaT 목록 page를 raw-first 관측과 봉인된 숫자 ID manifest로 확장한다."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Protocol, get_args
from uuid import UUID

from eatbid.core.build_identity import validate_build_sha
from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import ReleaseDatasetPlan, SourceReleasePlan
from eatbid.ingest.repository import CaptureRunMode
from eatbid.source.client import SourceClient, SourceResponse
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.source.eat.models import BidListPage
from eatbid.source.eat.registry import require
from eatbid.source.eat.xml import EatPayloadError


@dataclass(frozen=True, slots=True, kw_only=True)
class DiscoveryPlan:
    source_release_id: UUID
    run_id: UUID
    detail_run_id: UUID
    # 어떤 모드가 이 발견을 만들었는지는 run ledger의 사실이다. 창은 이미 번역된 뒤이므로 여기서는
    # 모드를 다시 해석하지 않고 기록만 한다.
    mode: CaptureRunMode
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
        if not all(
            isinstance(value, UUID)
            for value in (self.source_release_id, self.run_id, self.detail_run_id)
        ):
            raise TypeError("discovery identities must be UUID values")
        if self.run_id == self.detail_run_id:
            raise ValueError("discovery and detail run identities must differ")
        if not self.release_name or not self.parser_version:
            raise ValueError("release_name and parser_version are required")
        if self.mode not in get_args(CaptureRunMode):
            raise ValueError("discovery mode must be a capture run mode")
        validate_build_sha(self.build_sha)
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
    detail_run_id: UUID
    detail_request_unit_ids: tuple[int, ...]
    discovered_manifest_sha256: str


class DiscoveryPersistence(Protocol):
    """왜: use case가 R2·PostgreSQL adapter를 모르면서도 raw-first 순서를 강제한다."""

    def start_run(self, plan: DiscoveryPlan) -> None: ...

    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit: ...

    def archive_observation(
        self, request: CaptureRequest, response: SourceResponse
    ) -> CapturedObservation: ...

    def finalize_run_expected_count(self, run_id: UUID, expected_count: int) -> None: ...

    def start_detail_run(self, plan: DiscoveryPlan, expected_count: int) -> None: ...

    def plan_detail(
        self, plan: DiscoveryPlan, external_bid_id: str
    ) -> PlannedRequestUnit: ...

    def plan_release(self, plan: SourceReleasePlan) -> None: ...

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None: ...

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None: ...

    def complete_discovery_run(self, run_id: UUID) -> None: ...

    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None: ...


def discover_release(
    plan: DiscoveryPlan,
    repository: DiscoveryPersistence,
    client: SourceClient,
) -> DiscoveryResult:
    # 실행 단위는 parser version 하나다. 검토되지 않은 version이면 여기서 fail-closed 되어 raw
    # 관측조차 만들지 않는다. 목록과 상세가 같은 version으로 읽힌다는 것도 여기서 함께 고정된다.
    require("bid-list", parser_version=plan.parser_version)
    require("bid-detail", parser_version=plan.parser_version)

    repository.start_run(plan)
    observations: list[CapturedObservation] = []
    source_ids: list[str] = []
    try:
        first = _fetch_page(plan, 1, repository, client)
        observations.append(first[0])
        page = first[1]
        total_count = page.total_count
        if total_count > plan.page_budget * plan.page_size:
            raise SourceContractError("discovery page budget is insufficient")
        required_pages = max(1, (total_count + plan.page_size - 1) // plan.page_size)
        repository.finalize_run_expected_count(plan.run_id, required_pages)
        _require_page_size(page.external_bid_ids, 1, required_pages, total_count, plan.page_size)
        source_ids.extend(page.external_bid_ids)
        seen = set(page.external_bid_ids)

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
            duplicates = seen.intersection(current.external_bid_ids)
            if duplicates:
                raise SourceContractError("discovery contains duplicate source IDs")
            seen.update(current.external_bid_ids)
            source_ids.extend(current.external_bid_ids)

        if len(source_ids) != total_count:
            raise SourceContractError("discovery row total differs from source count")
        ordered_ids = tuple(sorted(source_ids, key=int))
        repository.start_detail_run(plan, total_count)
        detail_units = tuple(
            repository.plan_detail(plan, source_id) for source_id in ordered_ids
        )
        release_plan = _release_plan(plan, total_count)
        repository.plan_release(release_plan)
        repository.attach_run(plan.source_release_id, plan.run_id)
        repository.attach_run(plan.source_release_id, plan.detail_run_id)
        for observation in observations:
            repository.attach_observation(
                plan.source_release_id, observation.observation_id
            )
        repository.complete_discovery_run(plan.run_id)
        manifest = json.dumps(
            ordered_ids, ensure_ascii=True, separators=(",", ":")
        ).encode()
        return DiscoveryResult(
            source_release_id=plan.source_release_id,
            expected_count=total_count,
            external_bid_ids=ordered_ids,
            observation_ids=tuple(item.observation_id for item in observations),
            detail_run_id=plan.detail_run_id,
            detail_request_unit_ids=tuple(unit.request_unit_id for unit in detail_units),
            discovered_manifest_sha256=sha256(manifest).hexdigest(),
        )
    except Exception as error:
        _best_effort_fail(repository, plan, error)
        error.__context__ = None
        error.__cause__ = None
        raise error from None


def _best_effort_fail(
    repository: DiscoveryPersistence, plan: DiscoveryPlan, error: Exception
) -> None:
    try:
        repository.fail_run(plan, error)
    except Exception:  # noqa: BLE001 - 원래 typed failure만 외부 경계로 보낸다.
        return


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
    try:
        page = parse_bid_list_page(response.body, parser_version=plan.parser_version)
    except EatPayloadError:
        raise SourceContractError("discovery response is malformed") from None
    return observation, page


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
    list_contract = require("bid-list", parser_version=plan.parser_version)
    detail_contract = require("bid-detail", parser_version=plan.parser_version)
    (list_dataset,) = list_contract.response_datasets
    detail_dataset = detail_contract.response_datasets[0]
    return SourceReleasePlan(
        source_release_id=plan.source_release_id,
        source="eat",
        release_name=plan.release_name,
        as_of=plan.as_of,
        datasets=(
            ReleaseDatasetPlan(
                endpoint=list_contract.endpoint,
                dataset=list_dataset,
                record_type=list_contract.record_type,
                parser_version=list_contract.parser_version,
                schema_fingerprint=list_contract.schema_fingerprint,
                expected_count=expected_count,
                observed_count=expected_count,
                normalized_count=expected_count,
                quarantined_count=0,
                required=True,
            ),
            ReleaseDatasetPlan(
                endpoint=detail_contract.endpoint,
                dataset=detail_dataset,
                record_type=detail_contract.record_type,
                parser_version=detail_contract.parser_version,
                schema_fingerprint=detail_contract.schema_fingerprint,
                expected_count=expected_count,
                observed_count=0,
                normalized_count=0,
                quarantined_count=0,
                required=True,
            ),
        ),
    )
