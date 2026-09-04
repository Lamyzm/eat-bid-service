from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID

import pytest

from eatbid.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import SourceReleasePlan
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.source.client import SourceResponse

RUN_ID = UUID("41000000-0000-0000-0000-000000000001")
DETAIL_RUN_ID = UUID("41000000-0000-0000-0000-000000000003")
RELEASE_ID = UUID("41000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 9, 1, 1, 0, tzinfo=UTC)


def _목록_xml(total: int, ids: tuple[str, ...]) -> bytes:
    rows = "".join(
        f'<Row><Col id="TOT_CNT">{total}</Col><Col id="ETN_BID_ID">{bid_id}</Col>'
        '<Col id="BID_CNT">0</Col><Col id="ETN_BID_STT_NM">입찰공고</Col>'
        '<Col id="BID_END_DT">20260914100000000</Col>'
        '<Col id="LAST_CHG_DT">20260902175956000</Col></Row>'
        for bid_id in ids
    )
    if total == 0:
        rows = '<Row><Col id="TOT_CNT">0</Col><Col id="ETN_BID_ID"></Col></Row>'
    return (
        '<Root xmlns="http://www.nexacroplatform.com/platform/dataset">'
        '<Dataset id="ds_list"><ColumnInfo><Column id="TOT_CNT"/>'
        '<Column id="ETN_BID_ID"/><Column id="BID_CNT"/><Column id="ETN_BID_STT_NM"/>'
        '<Column id="BID_END_DT"/><Column id="LAST_CHG_DT"/></ColumnInfo>'
        f"<Rows>{rows}</Rows></Dataset></Root>"
    ).encode()


def _계획(
    *, page_size: int = 2, page_budget: int = 4, parser_version: str = "eat-v1"
) -> DiscoveryPlan:
    return DiscoveryPlan(
        source_release_id=RELEASE_ID,
        run_id=RUN_ID,
        detail_run_id=DETAIL_RUN_ID,
        mode="backfill",
        release_name="R0 오프라인 발견",
        as_of=NOW,
        build_sha="a" * 64,
        parser_version=parser_version,
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
    def __init__(self, pages: tuple[bytes | SourceResponse, ...]) -> None:
        self.pages = pages
        self.requests: list[CaptureRequest] = []

    def fetch(self, request: CaptureRequest) -> SourceResponse:
        self.requests.append(request)
        item = self.pages[len(self.requests) - 1]
        return item if isinstance(item, SourceResponse) else SourceResponse(200, item, NOW)


@dataclass
class _상태:
    manifest_sha256: str = "f" * 64


class _기록저장소:
    def __init__(self, *, fail_error: Exception | None = None) -> None:
        self.events: list[str] = []
        self.observations: list[CapturedObservation] = []
        self.release_plan: SourceReleasePlan | None = None
        self.detail_ids: list[str] = []
        self.fail_error = fail_error

    def start_run(self, plan: DiscoveryPlan) -> None: self.events.append("discovery_started")
    def plan_page(self, plan: DiscoveryPlan, page_number: int) -> PlannedRequestUnit:
        self.events.append(f"page_{page_number}_planned")
        return _unit(plan.run_id, page_number, "bid-list", {"START_PAGE": str(page_number)})
    def archive_observation(self, request: CaptureRequest, response: SourceResponse) -> CapturedObservation:
        self.events.extend(("raw_archived", "observation_recorded"))
        observation = CapturedObservation(len(self.observations) + 1, "c" * 64, f"raw/eat/bid-list/{'c' * 64}.xml.gz", NOW)
        self.observations.append(observation)
        if response.status_code >= 400:
            raise SourceContractError("stable contract")
        return observation
    def finalize_run_expected_count(self, run_id: UUID, expected_count: int) -> None:
        self.events.append(f"expected_{expected_count}")
    def start_detail_run(self, plan: DiscoveryPlan, expected_count: int) -> None:
        self.events.append(f"detail_started_{expected_count}")
    def plan_detail(self, plan: DiscoveryPlan, external_bid_id: str) -> PlannedRequestUnit:
        self.detail_ids.append(external_bid_id)
        self.events.append(f"detail_{external_bid_id}_planned")
        return _unit(plan.detail_run_id, 100 + len(self.detail_ids), "bid-detail", {"ELCTRN_BID_ID": external_bid_id})
    def plan_release(self, plan: SourceReleasePlan) -> None:
        self.release_plan = plan
        self.events.append("release_planned")
    def attach_run(self, source_release_id: UUID, run_id: UUID) -> None: self.events.append(f"run_{run_id}_attached")
    def attach_observation(self, source_release_id: UUID, observation_id: int) -> None: self.events.append(f"observation_{observation_id}_attached")
    def complete_discovery_run(self, run_id: UUID) -> None: self.events.append("discovery_completed")
    def fail_run(self, plan: DiscoveryPlan, error: Exception) -> None:
        self.events.append("failed")
        if self.fail_error is not None: raise self.fail_error


def _unit(run_id: UUID, unit_id: int, endpoint: str, params: dict[str, str]) -> PlannedRequestUnit:
    return PlannedRequestUnit(unit_id, run_id, "eat", endpoint, params, "b" * 64)


def test_discovery가_정렬_ID를_detail_request로_영속화하고_planned_release를_남긴다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(3, ("3", "1")), _목록_xml(3, ("2",))))

    result = discover_release(_계획(), repository, client)

    assert result.external_bid_ids == ("1", "2", "3")
    assert repository.detail_ids == ["1", "2", "3"]
    assert result.discovered_manifest_sha256 == sha256(b'["1","2","3"]').hexdigest()
    assert repository.release_plan is not None
    assert [(item.endpoint, item.expected_count, item.observed_count, item.normalized_count) for item in repository.release_plan.datasets] == [
        ("bid-list", 3, 3, 3), ("bid-detail", 3, 0, 0)
    ]
    assert "release_sealed" not in repository.events


def test_검토되지_않은_parser_version은_run을_시작하기_전에_닫힌다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(1, ("1",)),))

    with pytest.raises(SourceContractError, match="unknown-parser-version"):
        discover_release(_계획(parser_version="eat-v9"), repository, client)

    assert repository.events == []
    assert client.requests == []


def test_eat_v2_발견은_상세_dataset을_auction_v2로_계획한다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(1, ("1",)),))

    discover_release(_계획(parser_version="eat-v2"), repository, client)

    assert repository.release_plan is not None
    assert [
        (item.endpoint, item.record_type, item.parser_version)
        for item in repository.release_plan.datasets
    ] == [
        ("bid-list", "auction-discovery.v1", "eat-v2"),
        ("bid-detail", "auction.v2", "eat-v2"),
    ]


def test_첫page_뒤_정확한_page_count를_두번째_HTTP_전에_확정한다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(5, ("1", "2")), _목록_xml(5, ("3", "4")), _목록_xml(5, ("5",))))
    discover_release(_계획(), repository, client)
    assert repository.events.index("expected_3") < repository.events.index("page_2_planned")


def test_page2_중복은_page3_HTTP_전에_실패한다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(5, ("1", "2")), _목록_xml(5, ("2", "3"))))
    with pytest.raises(SourceContractError): discover_release(_계획(), repository, client)
    assert len(client.requests) == 2
    assert repository.release_plan is None


def test_0건_wire는_빈_manifest로_exact_complete_planned_release를_만든다() -> None:
    repository = _기록저장소()
    result = discover_release(_계획(), repository, _쪽클라이언트((_목록_xml(0, ()),)))
    assert result.expected_count == 0
    assert result.external_bid_ids == ()
    assert repository.detail_ids == []
    assert repository.release_plan is not None


def test_huge_total은_다음_HTTP_전에_SOURCE_CONTRACT로_닫힌다() -> None:
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(10**200, ("1", "2")),))
    with pytest.raises(SourceContractError): discover_release(_계획(), repository, client)
    assert len(client.requests) == 1


def test_failure_기록실패는_원래_typed_error와_context를_바꾸지_않는다() -> None:
    repository = _기록저장소(fail_error=RuntimeError("postgresql://secret"))
    client = _쪽클라이언트((original_response := SourceResponse(500, b"broken", NOW),))
    with pytest.raises(SourceContractError) as captured:
        discover_release(_계획(), repository, client)
    assert captured.value.__cause__ is None
    assert captured.value.__context__ is None
    assert "secret" not in repr(captured.value)
    assert original_response.status_code == 500
