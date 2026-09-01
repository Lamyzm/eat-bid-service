"""모듈 책임: discovery port를 raw store·ingest·source release 저장 경계로 조합한다."""

from __future__ import annotations

from datetime import datetime
from uuid import UUID

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import (
    ReleaseDatasetProgress,
    SealedSourceRelease,
    SourceReleasePlan,
)
from eatbid.ingest.release_repository import SourceReleaseRepository
from eatbid.ingest.repository import IngestRepository
from eatbid.object_store import RawObjectStore
from eatbid.pipeline.capture import (
    SOURCE_CONTRACT,
    SOURCE_THROTTLED,
    SourceThrottledError,
    capture_response,
)
from eatbid.pipeline.discover import DiscoveryPlan
from eatbid.source.client import SourceResponse
from eatbid.source.eat.registry import require


class RawFirstDiscoveryPersistence:
    """왜: 객체 보존 성공 전에는 observation과 release membership을 만들지 않는다."""

    def __init__(
        self,
        *,
        ingest_repository: IngestRepository,
        release_repository: SourceReleaseRepository,
        raw_store: RawObjectStore,
    ) -> None:
        self._ingest = ingest_repository
        self._release = release_repository
        self._raw_store = raw_store

    def start_run(self, plan: DiscoveryPlan) -> None:
        self._ingest.start_run(
            run_id=plan.run_id,
            mode="backfill",
            build_sha=plan.build_sha,
            parser_version=plan.parser_version,
            started_at=plan.started_at,
            # 첫 raw observation이 생기는 동안에도 count 불변식을 깨지 않는다.
            expected_count=1,
        )

    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit:
        params = require("bid-list").build_page_params(
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

    def plan_release(self, plan: SourceReleasePlan) -> None:
        self._release.plan_release(plan)

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None:
        self._release.attach_run(source_release_id, run_id)

    def attach_observation(
        self, source_release_id: UUID, observation_id: int
    ) -> None:
        self._release.attach_observation(source_release_id, observation_id)

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None:
        self._release.record_dataset_progress(source_release_id, progress)

    def seal_release(
        self, source_release_id: UUID, *, sealed_at: datetime
    ) -> SealedSourceRelease:
        return self._release.seal_release(source_release_id, sealed_at=sealed_at)

    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None:
        category = (
            SOURCE_THROTTLED if isinstance(error, SourceThrottledError) else SOURCE_CONTRACT
        )
        try:
            self._ingest.fail_run(
                run_id=plan.run_id,
                failure_category=category,
                failed_at=plan.completed_at,
            )
        except Exception:  # noqa: BLE001 - 원래 typed discovery 실패를 덮지 않는다.
            # 원래 discovery 실패가 권위이며 provider/DB 상세를 cause로 노출하지 않는다.
            raise SourceContractError("discovery run failure could not be recorded") from None
