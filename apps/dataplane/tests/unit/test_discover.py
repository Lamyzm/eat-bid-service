from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import UTC, datetime
from hashlib import sha256
from uuid import UUID

import pytest

from eatbid.failures.errors import SourceContractError
from eatbid.ingest.models import CapturedObservation, CaptureRequest, PlannedRequestUnit
from eatbid.ingest.release_models import SourceReleasePlan
from eatbid.ingest.repository import CollectionRunMode
from eatbid.pipeline.discover import DiscoveryPlan, discover_release
from eatbid.pipeline.refetch_policy import ListSignal, RefetchBaseline
from eatbid.source.client import SourceResponse

RUN_ID = UUID("41000000-0000-0000-0000-000000000001")
DETAIL_RUN_ID = UUID("41000000-0000-0000-0000-000000000003")
RELEASE_ID = UUID("41000000-0000-0000-0000-000000000002")
NOW = datetime(2026, 9, 1, 1, 0, tzinfo=UTC)


def _목록_xml(
    total: int, ids: tuple[str, ...], *, bid_counts: dict[str, int] | None = None
) -> bytes:
    counts = bid_counts or {}
    rows = "".join(
        f'<Row><Col id="TOT_CNT">{total}</Col><Col id="ETN_BID_ID">{bid_id}</Col>'
        f'<Col id="BID_CNT">{counts.get(bid_id, 0)}</Col><Col id="ETN_BID_STT_NM">입찰공고</Col>'
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
    *,
    page_size: int = 2,
    page_budget: int = 4,
    parser_version: str = "eat-v1",
    mode: CollectionRunMode = "backfill",
) -> DiscoveryPlan:
    return DiscoveryPlan(
        source_release_id=RELEASE_ID,
        run_id=RUN_ID,
        detail_run_id=DETAIL_RUN_ID,
        mode=mode,
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
    def __init__(
        self,
        *,
        fail_error: Exception | None = None,
        baseline: RefetchBaseline | None = None,
    ) -> None:
        self.events: list[str] = []
        self.observations: list[CapturedObservation] = []
        self.release_plan: SourceReleasePlan | None = None
        self.detail_ids: list[str] = []
        self.fail_error = fail_error
        self.baseline = baseline

    def load_refetch_baseline(self, plan: DiscoveryPlan) -> RefetchBaseline | None:
        self.events.append("baseline_loaded")
        return self.baseline

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


def test_순회_중_목록이_자라_경계가_겹치면_한_번만_세고_회차는_성공한다() -> None:
    """2026-09-14 운영 실측의 모양이다. 소스는 최신순으로 주므로 새 공고는 맨 앞에 붙고 전체가 뒤로
    밀린다. 그래서 페이지 2의 마지막과 페이지 3의 첫 번째가 같은 공고가 되고 마지막 페이지가 한 행
    더 실려 온다. 빠진 건은 없으므로 회차를 죽이지 않는다(EAT-212)."""
    repository = _기록저장소()
    # page_size 2, 첫 총수 5 → 3페이지. 마지막 페이지에서 총수가 6으로 자라고 "4"가 겹쳐 온다.
    client = _쪽클라이언트(
        (
            _목록_xml(5, ("5", "4")),
            _목록_xml(5, ("3", "2")),
            _목록_xml(6, ("2", "1")),
        )
    )

    result = discover_release(_계획(), repository, client)

    # 겹친 "2"는 한 번만 센다. 집합 크기는 페이지 1의 총수와 같다.
    assert result.external_bid_ids == ("1", "2", "3", "4", "5")
    assert repository.detail_ids == ["1", "2", "3", "4", "5"]
    assert repository.release_plan is not None


def test_순회_중_목록이_줄면_경계의_한_건을_조용히_놓치므로_실패한다() -> None:
    """줄어드는 쪽은 뒤가 앞으로 당겨져 경계의 한 건이 아무 신호 없이 사라진다. 이 방향은 막는다."""
    repository = _기록저장소()
    client = _쪽클라이언트((_목록_xml(5, ("5", "4")), _목록_xml(4, ("3", "2"))))

    with pytest.raises(SourceContractError, match="shrank"):
        discover_release(_계획(), repository, client)

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


def _기준(signals: dict[str, int]) -> RefetchBaseline:
    return RefetchBaseline(
        source_release_id=UUID("41000000-0000-0000-0000-00000000000b"),
        observed_at=datetime(2026, 9, 1, 0, 30, tzinfo=UTC),
        signals={
            bid_id: ListSignal(
                competitor_count=count,
                status_name="입찰공고",
                deadline_at=datetime(2026, 9, 14, 1, 0, tzinfo=UTC),
                last_changed_at=datetime(2026, 9, 2, 8, 59, 56, tzinfo=UTC),
            )
            for bid_id, count in signals.items()
        },
    )


def test_poll_open은_기준과_신호가_같은_공고의_상세를_계획하지_않는다() -> None:
    repository = _기록저장소(baseline=_기준({"1": 0, "2": 0, "3": 0}))
    client = _쪽클라이언트((_목록_xml(3, ("3", "1")), _목록_xml(3, ("2",))))

    result = discover_release(_계획(mode="poll-open"), repository, client)

    assert result.external_bid_ids == ("1", "2", "3")
    assert result.detail_external_bid_ids == ()
    assert result.external_bid_id_chunks == ()
    assert repository.detail_ids == []
    assert result.refetch_reason_counts == {"unchanged": 3}
    assert result.baseline_source_release_id == repository.baseline.source_release_id
    assert "detail_started_0" in repository.events
    assert repository.release_plan is not None
    assert [
        (item.endpoint, item.expected_count) for item in repository.release_plan.datasets
    ] == [("bid-list", 3), ("bid-detail", 0)]
    assert repository.events.index("baseline_loaded") < repository.events.index(
        "detail_started_0"
    )


def test_poll_open은_BID_CNT가_오른_공고와_기준에_없던_공고만_상세를_계획한다() -> None:
    repository = _기록저장소(baseline=_기준({"1": 0, "3": 5}))
    client = _쪽클라이언트(
        (_목록_xml(3, ("3", "1"), bid_counts={"3": 6}), _목록_xml(3, ("2",)))
    )

    result = discover_release(_계획(mode="poll-open"), repository, client)

    assert result.detail_external_bid_ids == ("2", "3")
    assert repository.detail_ids == ["2", "3"]
    assert result.refetch_reason_counts == {
        "new": 1,
        "signal-changed": 1,
        "unchanged": 1,
    }
    assert result.discovered_manifest_sha256 == sha256(b'["1","2","3"]').hexdigest()
    assert repository.release_plan is not None
    assert [
        (item.endpoint, item.expected_count) for item in repository.release_plan.datasets
    ] == [("bid-list", 3), ("bid-detail", 2)]


def test_poll_open이라도_봉인된_기준이_없으면_전부_상세를_계획한다() -> None:
    repository = _기록저장소(baseline=None)
    client = _쪽클라이언트((_목록_xml(2, ("1", "2")),))

    result = discover_release(_계획(mode="poll-open"), repository, client)

    assert result.detail_external_bid_ids == ("1", "2")
    assert result.refetch_reason_counts == {"no-baseline": 2, "unchanged": 0}
    assert result.baseline_source_release_id is None


def test_backfill과_daily_reconcile은_기준을_읽지_않고_목록_전부의_상세를_계획한다() -> None:
    for mode in ("backfill", "daily-reconcile"):
        repository = _기록저장소(baseline=_기준({"1": 0, "2": 0}))
        client = _쪽클라이언트((_목록_xml(2, ("1", "2")),))

        result = discover_release(_계획(mode=mode), repository, client)

        assert "baseline_loaded" not in repository.events, mode
        assert result.detail_external_bid_ids == ("1", "2"), mode
        assert result.refetch_reason_counts == {"full-mode": 2, "unchanged": 0}, mode
        assert result.baseline_source_release_id is None, mode


def test_release_commit_40자_build_sha로도_발견_계획을_만든다() -> None:
    plan = _계획()
    release_commit = "9c9ff63f479d03f0fbfcc036954e8470b182bb61"

    assert replace(plan, build_sha=release_commit).build_sha == release_commit


@pytest.mark.parametrize("build_sha", ["a" * 39, "a" * 41, "A" * 40, "a" * 63])
def test_hex_정체성이_아닌_build_sha는_발견_계획에서_거부한다(build_sha: str) -> None:
    with pytest.raises(ValueError, match="lowercase 40 or 64 character"):
        replace(_계획(), build_sha=build_sha)
