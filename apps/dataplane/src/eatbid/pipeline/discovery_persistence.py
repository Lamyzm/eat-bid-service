"""모듈 책임: discovery port를 raw store·ingest·source release 저장 경계로 조합한다."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from eatbid.failures.categories import failure_category_for_error
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import SourceReleasePlan
from eatbid.ingest.release_repository import SourceReleaseRepository
from eatbid.ingest.repository import IngestRepository
from eatbid.pipeline.capture import capture_response
from eatbid.pipeline.discover import DiscoveryPlan
from eatbid.pipeline.refetch_baseline import RefetchBaselineReader
from eatbid.pipeline.refetch_policy import RefetchBaseline
from eatbid.source.client import SourceResponse
from eatbid.source.eat.registry import require
from eatbid.storage.object_store import RawObjectStore


class RawFirstDiscoveryPersistence:
    """왜: 객체 보존 성공 전에는 observation과 release membership을 만들지 않는다."""

    def __init__(
        self,
        *,
        ingest_repository: IngestRepository,
        release_repository: SourceReleaseRepository,
        raw_store: RawObjectStore,
        baseline_reader: RefetchBaselineReader,
    ) -> None:
        self._ingest = ingest_repository
        self._release = release_repository
        self._raw_store = raw_store
        self._baseline_reader = baseline_reader
        self._completed_at: datetime | None = None

    def start_run(self, plan: DiscoveryPlan) -> None:
        self._completed_at = plan.completed_at
        self._ingest.start_run(
            run_id=plan.run_id,
            mode=plan.mode,
            build_sha=plan.build_sha,
            parser_version=plan.parser_version,
            started_at=plan.started_at,
            # 첫 raw observation이 생기는 동안에도 count 불변식을 깨지 않는다.
            expected_count=1,
            workflow_name=plan.workflow_name,
        )

    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit:
        params = require(
            "bid-list", parser_version=plan.parser_version
        ).build_page_params(
            start_date=plan.start_date,
            end_date=plan.end_date,
            progress_status_code=plan.progress_status_code,
            region_code=plan.region_code,
            page_number=page_number,
            page_size=plan.page_size,
        )
        return self._ingest.plan_request_unit(
            run_id=plan.run_id,
            source="eat",
            endpoint="bid-list",
            params=params,
            expected_count=1,
        )

    def archive_observation(
        self, request: CaptureRequest, response: SourceResponse
    ) -> CapturedObservation:
        return capture_response(request, response, self._raw_store, self._ingest)

    def finalize_run_expected_count(self, run_id: UUID, expected_count: int) -> None:
        self._ingest.finalize_run_expected_count(
            run_id=run_id, expected_count=expected_count
        )

    def start_detail_run(self, plan: DiscoveryPlan, expected_count: int) -> None:
        self._ingest.start_run(
            run_id=plan.detail_run_id,
            mode=plan.mode,
            build_sha=plan.build_sha,
            parser_version=plan.parser_version,
            started_at=plan.started_at,
            expected_count=expected_count,
            workflow_name=plan.workflow_name,
        )

    def plan_detail(
        self, plan: DiscoveryPlan, external_bid_id: str
    ) -> PlannedRequestUnit:
        contract = require("bid-detail", parser_version=plan.parser_version)
        return self._ingest.plan_request_unit(
            run_id=plan.detail_run_id,
            source="eat",
            endpoint=contract.endpoint,
            params=contract.build_detail_params(external_bid_id),
            expected_count=1,
        )

    def load_refetch_baseline(self, plan: DiscoveryPlan) -> RefetchBaseline | None:
        return self._baseline_reader.load(parser_version=plan.parser_version)

    def plan_release(self, plan: SourceReleasePlan) -> None:
        self._release.plan_release(plan)

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None:
        self._release.attach_run(source_release_id, run_id)

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None:
        self._release.attach_observation(source_release_id, observation_id)

    def complete_discovery_run(self, run_id: UUID) -> None:
        if self._completed_at is None:
            raise RuntimeError("discovery run was not started")
        self._ingest.complete_discovery_run(
            run_id=run_id, completed_at=self._completed_at
        )

    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None:
        """왜: run 표에 남는 카테고리는 프로세스 exit code와 같은 판정이어야 한다. 여기서 비-throttle을
        모두 계약 위반으로 접으면, 응답조차 오지 않아 exit 69로 끝난 실행이 ledger에는 '코드를 고쳐야
        하는 실패'로 남아 운영자가 원인을 반대로 읽는다."""
        try:
            self._ingest.fail_run(
                run_id=plan.run_id,
                failure_category=failure_category_for_error(error),
                failed_at=plan.completed_at,
            )
        except Exception:  # noqa: BLE001 - 원래 typed discovery 실패를 덮지 않는다.
            return
