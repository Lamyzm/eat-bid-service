from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID

import pytest

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import ReleaseDatasetProgress, SourceReleasePlan
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.source.client import SourceResponse

RUN_ID = UUID("41000000-0000-0000-0000-000000000001")
RELEASE_ID = UUID("41000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 9, 1, 1, 0, tzinfo=UTC)


def _목록_xml(total: int, ids: tuple[str, ...]) -> bytes:
    rows = "".join(
        f'<Row><Col id="TOT_CNT">{total}</Col><Col id="ETN_BID_ID">{bid_id}</Col></Row>'
        for bid_id in ids
    )
    return (
        '<Root xmlns="http://www.nexacroplatform.com/platform/dataset">'
        '<Dataset id="ds_list"><ColumnInfo>'
        '<Column id="TOT_CNT"/><Column id="ETN_BID_ID"/>'
        f"</ColumnInfo><Rows>{rows}</Rows></Dataset></Root>"
    ).encode()


def _계획(*, page_size: int = 2, page_budget: int = 3) -> DiscoveryPlan:
    return DiscoveryPlan(
        source_release_id=RELEASE_ID,
        run_id=RUN_ID,
        release_name="R0 오프라인 발견",
        as_of=NOW,
        build_sha="a" * 64,
        parser_version="eat-v1",
        started_at=NOW,
        completed_at=NOW,
        start_date="20260901",
        end_date="20260901",
        progress_status_code="",
        region_code="",
        page_size=page_size,
        page_budget=page_budget,
    )


class _쪽클라이언트:
    def __init__(self, pages: tuple[bytes, ...]) -> None:
        self.pages = pages
        self.requests: list[CaptureRequest] = []

    def fetch(self, request: CaptureRequest) -> SourceResponse:
        self.requests.append(request)
        return SourceResponse(200, self.pages[len(self.requests) - 1], NOW)


@dataclass
class _봉인결과:
    manifest_sha256: str = "f" * 64


class _기록저장소:
    def __init__(self) -> None:
        self.events: list[str] = []
        self.observations: list[CapturedObservation] = []
        self.release_plan: SourceReleasePlan | None = None
        self.seal_count = 0
        self.failed_count = 0

    def start_run(self, plan: DiscoveryPlan) -> None:
        self.events.append("run_started")

    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit:
        self.events.append(f"page_{page_number}_planned")
        return PlannedRequestUnit(
            request_unit_id=page_number,
            run_id=plan.run_id,
            source="eat",
            endpoint="bid-list",
            params={
                "P_BID_BGNG_DT": plan.start_date,
                "P_BID_END_DT": plan.end_date,
                "P_PRGRS_STAT_CD": plan.progress_status_code,
                "P_CTPV_CD": plan.region_code,
                "START_PAGE": str(page_number),
                "PAGE_SIZE": str(plan.page_size),
            },
            request_params_hash="b" * 64,
        )

    def archive_observation(
        self, request: CaptureRequest, response: SourceResponse
    ) -> CapturedObservation:
        self.events.extend(("raw_archived", "observation_recorded"))
        observation = CapturedObservation(
            observation_id=len(self.observations) + 1,
            content_sha256="c" * 64,
            object_key=f"raw/eat/bid-list/{'c' * 64}.xml.gz",
            fetched_at=NOW,
        )
        self.observations.append(observation)
        return observation

    def finalize_run_expected_count(self, run_id: UUID, expected_count: int) -> None:
        self.events.append(f"run_expected_{expected_count}")

    def plan_release(self, plan: SourceReleasePlan) -> None:
        self.release_plan = plan
        self.events.append("release_planned")

    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None:
        self.events.append("run_attached")

    def attach_observation(self, source_release_id: UUID, observation_id: int) -> None:
        self.events.append(f"observation_{observation_id}_attached")

    def record_dataset_progress(
        self, source_release_id: UUID, progress: ReleaseDatasetProgress
    ) -> None:
        self.events.append(f"progress_{progress.observed_count}")

    def seal_release(self, source_release_id: UUID, *, sealed_at: datetime) -> _봉인결과:
        self.seal_count += 1
        self.events.append("release_sealed")
        return _봉인결과()

    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None:
        self.failed_count += 1


def test_discovery가_stable_total과_정렬된_숫자_ID_manifest를_봉인한다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(3, ("3", "1")), _목록_xml(3, ("2",))))

    result = discover_release(_계획(), repository, client)

    assert result.expected_count == 3
    assert result.external_bid_ids == ("1", "2", "3")
    assert result.observation_ids == (1, 2)
    assert repository.release_plan is not None
    dataset = repository.release_plan.datasets[0]
    assert dataset.record_type == "auction-discovery.v1"
    assert dataset.parser_version == "eat-v1"
    assert dataset.schema_fingerprint != "f" * 64
    assert repository.seal_count == 1


@pytest.mark.parametrize(
    "pages",
    [
        (_목록_xml(2, ("1", "1")),),
        (_목록_xml(3, ("1", "2")), _목록_xml(3, ("2",))),
        (_목록_xml(3, ("1", "2")), _목록_xml(4, ("3",))),
        (_목록_xml(4, ("1", "2")), _목록_xml(4, ())),
        (_목록_xml(3, ("1", "2")), _목록_xml(3, ())),
    ],
)
def test_중복_count변화_빈page_합계불일치는_raw만_보존하고_봉인하지_않는다(
    pages: tuple[bytes, ...],
) -> None:
    repository = _기록저장소()
    client = _쪽클라이언트(pages)

    with pytest.raises(SourceContractError):
        discover_release(_계획(), repository, client)

    assert repository.observations
    assert repository.release_plan is None
    assert repository.seal_count == 0
    assert repository.failed_count == 1


def test_page_budget은_초과_page_HTTP_전에_실패한다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(5, ("1", "2")),))

    with pytest.raises(SourceContractError):
        discover_release(_계획(page_budget=2), repository, client)

    assert len(client.requests) == 1
    assert repository.seal_count == 0


@pytest.mark.parametrize("source_id", ["01", "0", "가", "1" * 21])
def test_목록_ID는_bounded_positive_ASCII_decimal만_허용한다(
    source_id: str,
) -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(1, (source_id,)),))

    with pytest.raises(SourceContractError):
        discover_release(_계획(), repository, client)

    assert repository.seal_count == 0


def test_성공page는_raw_archive_observation_release_attach_순서를_지킨다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(1, ("1",)),))

    discover_release(_계획(), repository, client)

    assert repository.events.index("raw_archived") < repository.events.index(
        "observation_recorded"
    ) < repository.events.index("observation_1_attached")
