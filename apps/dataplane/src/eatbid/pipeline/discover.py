"""모듈 책임: eaT 목록 page를 raw-first 관측과 봉인된 숫자 ID manifest로 확장한다."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
from typing import Protocol, get_args
from uuid import UUID

from eatbid.core.build_identity import validate_build_sha
from eatbid.failures.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import ReleaseDatasetPlan, SourceReleasePlan
from eatbid.ingest.repository import CollectionRunMode
from eatbid.pipeline.chunk import split_into_chunks
from eatbid.pipeline.refetch_policy import (
    NARROWED_MODES,
    RefetchBaseline,
    select_detail_refetch,
)
from eatbid.source.client import SourceClient, SourceResponse
from eatbid.source.eat.bid_list import parse_bid_list_page
from eatbid.source.eat.models import BidListPage, BidListRow
from eatbid.source.eat.registry import require
from eatbid.source.eat.xml import EatPayloadError


@dataclass(frozen=True, slots=True, kw_only=True)
class DiscoveryPlan:
    source_release_id: UUID
    run_id: UUID
    detail_run_id: UUID
    # 어떤 모드가 이 발견을 만들었는지는 run ledger의 사실이다. 창은 이미 번역된 뒤이므로 여기서는
    # 모드를 다시 해석하지 않고 기록만 한다.
    mode: CollectionRunMode
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
    # 이 발견을 돌린 Argo Workflow 이름. run 행에 남겨 알림·R2 로그·릴리스를 잇는다(EAT-231). 워크플로
    # 밖(테스트·수동 실행)에서는 없으며 그것은 결함이 아니다.
    workflow_name: str | None = None

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
        # 발견은 날짜 창을 번역하는 실행이므로 창이 있는 모드만 받는다. `reference`는 창이 없다.
        if self.mode not in get_args(CollectionRunMode):
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
    # 목록이 준 전체 ID다. 발견 manifest와 `TOT_CNT` 대조는 이 목록의 사실이다.
    external_bid_ids: tuple[str, ...]
    observation_ids: tuple[int, ...]
    detail_run_id: UUID
    detail_request_unit_ids: tuple[int, ...]
    discovered_manifest_sha256: str
    # 이번 회차가 실제로 상세를 부르는 ID다. poll-open은 목록 신호가 바뀐 공고로 좁히므로
    # `external_bid_ids`의 부분집합이고, 그 외 모드에서는 둘이 같다(ADR 0037).
    detail_external_bid_ids: tuple[str, ...]
    refetch_reason_counts: Mapping[str, int]
    baseline_source_release_id: UUID | None

    def __post_init__(self) -> None:
        if not set(self.detail_external_bid_ids) <= set(self.external_bid_ids):
            raise ValueError("detail IDs must be discovered IDs")

    @property
    def external_bid_id_chunks(self) -> tuple[tuple[str, ...], ...]:
        """왜 발견이 fan-out 단위를 정하나. 다음 단계가 몇 개의 pod로 펼쳐질지는 상세를 부를 ID
        목록에서 곧바로 나오는 사실이고, 그 분할을 workflow manifest가 계산하면 매니페스트가 CLI와
        별개의 두 번째 설정 원천이 된다. 여기서 나눠 두면 계획된 request unit 순서 그대로 chunk가 된다."""
        return split_into_chunks(self.detail_external_bid_ids)


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

    def load_refetch_baseline(self, plan: DiscoveryPlan) -> RefetchBaseline | None: ...

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
    rows: list[BidListRow] = []
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
        rows.extend(page.rows)
        seen = set(page.external_bid_ids)

        # 소스는 최신순으로 주고 페이지가 정확히 이어진다(2026-09-14 원본 실측). 그래서 순회 중 목록이
        # 자라면 새 공고가 맨 앞에 붙고 전체가 뒤로 밀려, 경계의 한 건이 두 번 읽힌다. 우리가 모은 집합은
        # 페이지 1을 읽은 시점의 목록 그대로이며 빠진 건이 없다.
        #
        # 줄어드는 쪽은 다르다. 한 건이 목록에서 빠지면 뒤가 앞으로 당겨지고 경계의 한 건을 아무 신호
        # 없이 놓친다. 그래서 이 방향만 실패로 닫는다(EAT-212).
        latest_total = total_count
        drift_pages = 0
        for page_number in range(2, required_pages + 1):
            observation, current = _fetch_page(
                plan, page_number, repository, client
            )
            observations.append(observation)
            if current.total_count < latest_total:
                raise SourceContractError("discovery total count shrank between pages")
            if current.total_count > latest_total:
                latest_total = current.total_count
                drift_pages += 1
            _require_page_size(
                current.external_bid_ids,
                page_number,
                required_pages,
                total_count,
                plan.page_size,
                grew=drift_pages > 0,
            )
            duplicates = seen.intersection(current.external_bid_ids)
            # 목록이 자라지 않았는데 같은 ID가 두 페이지에 있으면 그것은 밀림이 아니라 소스가 같은 공고를
            # 두 번 실은 것이다. 그 경우만 계약 위반으로 닫는다.
            if duplicates and drift_pages == 0:
                raise SourceContractError("discovery contains duplicate source IDs")
            fresh = tuple(
                source_id
                for source_id in current.external_bid_ids
                if source_id not in seen
            )
            seen.update(fresh)
            source_ids.extend(fresh)
            rows.extend(
                row for row in current.rows if row.external_bid_id in set(fresh)
            )

        # 비교 대상은 마지막에 본 총수가 아니라 페이지 1의 총수다. 자란 만큼은 우리가 읽기 전에 앞에
        # 붙었으므로 이 회차의 집합에 들어오지 않는다. 그 사실은 drift로 남기고 다음 회차가 가져간다.
        if len(source_ids) != total_count:
            raise SourceContractError("discovery row total differs from source count")
        ordered_ids = tuple(sorted(source_ids, key=int))
        # 기준 읽기는 목록 관측이 끝난 뒤, 상세 run을 만들기 전이다. 기준을 못 읽는 실패도 이 run의
        # 실패로 남아야 하고, 좁히지 않는 모드는 R2를 다시 읽을 이유가 없다.
        baseline = (
            repository.load_refetch_baseline(plan) if plan.mode in NARROWED_MODES else None
        )
        selection = select_detail_refetch(
            rows, mode=plan.mode, baseline=baseline, as_of=plan.as_of
        )
        detail_count = len(selection.external_bid_ids)
        repository.start_detail_run(plan, detail_count)
        detail_units = tuple(
            repository.plan_detail(plan, source_id)
            for source_id in selection.external_bid_ids
        )
        release_plan = _release_plan(plan, total_count, detail_count)
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
            detail_external_bid_ids=selection.external_bid_ids,
            refetch_reason_counts=selection.reason_counts(),
            baseline_source_release_id=selection.baseline_source_release_id,
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
    *,
    grew: bool = False,
) -> None:
    """마지막 페이지는 목록이 자란 만큼 더 실려 온다. 자라지 않았을 때만 정확한 수를 요구한다.

    왜 상한만 보나. 목록이 커지면 마지막 페이지의 행 수가 `total_count`에서 계산한 값보다 커지는데
    (2026-09-14 실측: 156 대신 157) 그것은 소스가 계약을 어긴 것이 아니라 그 사이 공고가 하나 올라온
    것이다. 페이지 크기 자체는 여전히 상한이며 그것을 넘으면 계약 위반이다(EAT-212).
    """
    exact = (
        page_size
        if page_number < required_pages
        else total_count - page_size * (required_pages - 1)
    )
    if grew and page_number == required_pages:
        if not exact <= len(source_ids) <= page_size:
            raise SourceContractError("discovery page row count is out of range")
        return
    if len(source_ids) != exact:
        raise SourceContractError("discovery page row count is not exact")


def _release_plan(
    plan: DiscoveryPlan, expected_count: int, detail_count: int
) -> SourceReleasePlan:
    """목록 dataset의 expected는 소스가 선언한 `TOT_CNT`이고 상세 dataset의 expected는 이번 회차가
    계획한 request unit 수다. 상세 dataset의 완결성은 "계획한 것을 전부 관측했다"이지 "목록 전부를
    관측했다"가 아니다(ADR 0037). 목록 전부를 부르는 모드에서는 두 수가 같다."""
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
                expected_count=detail_count,
                observed_count=0,
                normalized_count=0,
                quarantined_count=0,
                required=True,
            ),
        ),
    )
