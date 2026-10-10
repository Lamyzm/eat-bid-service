"""모듈 책임: 정시 수집(poll-open)과 개찰 결과 줄(poll-results)의 발견이 목록 신호·마감 전이만으로 상세 재호출 대상을 고르는 규칙을 소유한다(ADR 0037·0064)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from uuid import UUID

from eatbid.ingest.repository import CollectionRunMode
from eatbid.source.eat.models import BidListRow

RefetchReason = Literal[
    "full-mode",
    "no-baseline",
    "new",
    "signal-changed",
    "deadline-passed",
    "post-deadline-window",
    "status-changed",
]
SKIP_REASON = "unchanged"

# 왜 poll-open만 좁히나. daily-reconcile은 7일 창 전부를 다시 부르는 하루 한 번의 강제 재호출이라
# 이 정책이 놓친 것을 하루 안에 되돌리는 안전망이고, backfill은 애초에 기준 관측이 없는 과거 창이다.
NARROWED_MODES: frozenset[CollectionRunMode] = frozenset({"poll-open", "poll-results"})

# 왜 2시간인가. 입찰 마감(`BID_END_DT`) 뒤 개찰·낙찰 결정은 목록 상태 라벨을 바꾸므로 신호 비교가
# 잡지만, 명단(`ds_bidList`)이 상태 변화 없이 채워지는 순간이 있는지는 아직 관측하지 못했다
# (ADR 0029 §후속). 30분 주기 네 회차 동안은 신호와 무관하게 다시 불러 그 공백을 메운다. 마감이
# 오전 9~11시에 73% 몰리므로(2026-09-06 실측 §3.2) 이 창의 비용은 하루 마감 건수 × 4회다.
POST_DEADLINE_REFETCH_WINDOW = timedelta(hours=2)

# 왜 창 안에서 30분 칸마다 한 번인가(ADR 0037 후속, EAT-329). 창의 비용 "마감 건수 × 4회"는 30분 주기에서
# 센 값인데, 주기가 10분이 되자(EAT-151) 같은 창이 회차마다 걸려 마감 건수 × 12회가 됐다. 성수기
# (2026-09-21)에는 회차 하나가 상세 5,774~7,139건·141~193분으로 부풀어 10분 주기가 무너졌다. 2026-09
# 오전 개찰 3,086건은 명단이 모두 낙찰 상태 전이와 함께 처음 보였고 개찰 상태의 명단은 0건이라, 창이
# 지키려는 공백은 회차마다가 아니라 30분 해상도로도 원래 설계만큼 덮인다. 칸은 마감 시각에서 센다.
POST_DEADLINE_REFETCH_INTERVAL = timedelta(minutes=30)


@dataclass(frozen=True, slots=True)
class ListSignal:
    """목록 한 행에서 상세가 달라졌을 수 있음을 말하는 값들이다.

    `BID_CNT`는 투찰 도착을, 상태 라벨은 마감·개찰·낙찰·취소 전이를, `BID_END_DT`는 연장을,
    `LAST_CHG_DT`는 공고 자체의 정정을 반영한다. `LAST_CHG_DT` 하나로는 투찰 도착을 놓친다는 것이
    2026-09-06 실측이므로(7건 모두 `BID_CNT`만 움직임) 넷을 함께 본다.
    """

    competitor_count: int
    status_name: str
    deadline_at: datetime
    last_changed_at: datetime

    @classmethod
    def from_row(cls, row: BidListRow) -> ListSignal:
        return cls(
            competitor_count=row.competitor_count,
            status_name=row.status_name,
            deadline_at=datetime.fromisoformat(row.deadline_at.root),
            last_changed_at=datetime.fromisoformat(row.last_changed_at.root),
        )


@dataclass(frozen=True, slots=True)
class RefetchBaseline:
    """마지막으로 봉인된 정기 수집 release의 목록 관측이다.

    봉인된 release만 기준이 되는 이유: 봉인은 그 release가 계획한 상세를 전부 관측했다는 증명이다
    (ADR 0025). 상세 캡처가 실패해 봉인되지 않은 회차는 기준에서 빠지므로, 그 회차에만 보였던 변화는
    다음 회차가 더 오래된 기준과 비교해 다시 잡는다.
    """

    source_release_id: UUID
    observed_at: datetime
    signals: Mapping[str, ListSignal]

    def __post_init__(self) -> None:
        if not isinstance(self.source_release_id, UUID):
            raise TypeError("baseline source_release_id must be a UUID")
        if self.observed_at.utcoffset() is None:
            raise ValueError("baseline observed_at must be timezone-aware")


@dataclass(frozen=True, slots=True)
class DetailSelection:
    external_bid_ids: tuple[str, ...]
    reasons: Mapping[str, RefetchReason]
    unchanged_count: int
    baseline_source_release_id: UUID | None

    def __post_init__(self) -> None:
        if set(self.external_bid_ids) != set(self.reasons):
            raise ValueError("every selected ID must carry exactly one reason")
        if isinstance(self.unchanged_count, bool) or self.unchanged_count < 0:
            raise ValueError("unchanged_count must be a nonnegative integer")

    def reason_counts(self) -> dict[str, int]:
        """운영자가 회차마다 읽는 요약이다. 건너뛴 수도 한 줄에 같이 둔다."""
        counts: dict[str, int] = {}
        for reason in self.reasons.values():
            counts[reason] = counts.get(reason, 0) + 1
        counts[SKIP_REASON] = self.unchanged_count
        return dict(sorted(counts.items()))


def select_detail_refetch(
    rows: Sequence[BidListRow],
    *,
    mode: CollectionRunMode,
    baseline: RefetchBaseline | None,
    as_of: datetime,
) -> DetailSelection:
    """어느 공고의 상세를 이번 회차에 다시 부를지 정한다.

    규칙 순서가 곧 우선순위다. 기준이 없으면 전부 부르고, 기준에 없던 공고·신호가 바뀐 공고는
    부르며, 기준 관측 뒤에 마감이 지났거나 마감 직후 창 안에서 새 30분 칸에 들어섰으면 신호가 같아도
    부른다. 나머지는 마지막 관측을 유지한다. 재공고 차수는 `ETN_BID_ID`가 다른 새 공고라 `new`로
    잡힌다(AGENTS 4).
    """
    if as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    reasons: dict[str, RefetchReason] = {}
    unchanged = 0
    for row in rows:
        reason = _reason_for(row, mode=mode, baseline=baseline, as_of=as_of)
        if reason is None:
            unchanged += 1
        else:
            reasons[row.external_bid_id] = reason
    return DetailSelection(
        external_bid_ids=tuple(sorted(reasons, key=int)),
        reasons=reasons,
        unchanged_count=unchanged,
        baseline_source_release_id=(
            baseline.source_release_id
            if baseline is not None and mode in NARROWED_MODES
            else None
        ),
    )


def _reason_for(
    row: BidListRow,
    *,
    mode: CollectionRunMode,
    baseline: RefetchBaseline | None,
    as_of: datetime,
) -> RefetchReason | None:
    if mode not in NARROWED_MODES:
        return "full-mode"
    if mode == "poll-results":
        return _results_reason(row, baseline)
    if baseline is None:
        return "no-baseline"
    current = ListSignal.from_row(row)
    previous = baseline.signals.get(row.external_bid_id)
    if previous is None:
        return "new"
    if previous != current:
        return "signal-changed"
    if baseline.observed_at < current.deadline_at <= as_of:
        return "deadline-passed"
    if _crossed_post_deadline_slot(current.deadline_at, baseline.observed_at, as_of):
        return "post-deadline-window"
    return None


def _results_reason(row: BidListRow, baseline: RefetchBaseline | None) -> RefetchReason | None:
    """결과 줄은 상태 라벨이 바뀐 공고만 부른다(ADR 0064).

    명단은 소스가 낙찰 전이 때 처음 준다(runtime §2.6, 오전 개찰 3,086건 전부). 그래서 이 줄이 볼 신호는 상태 라벨
    하나다. 새 공고·투찰 수·마감 연장·정정·마감 뒤 창은 정시 수집 몫으로 남긴다 — 이 줄이 맡으면 5분마다 소스를
    정시 수집만큼 부르게 된다. 기준이 없으면 무엇이 바뀌었는지 모르므로 아무것도 부르지 않는다. 전부 부르는
    것은 정시 수집의 일이다.
    """
    if baseline is None:
        return None
    previous = baseline.signals.get(row.external_bid_id)
    if previous is None:
        return None
    if previous.status_name != ListSignal.from_row(row).status_name:
        return "status-changed"
    return None


def _crossed_post_deadline_slot(deadline_at: datetime, baseline_at: datetime, as_of: datetime) -> bool:
    """마감 뒤 창 안에서 기준 관측 이후 새 30분 칸에 들어섰는지 본다.

    기준(마지막 봉인 회차)이 이미 같은 칸에서 상세를 불렀다면 이번 회차는 건너뛴다. 공고마다 마지막 상세
    시각을 새 표에 두지 않고(ADR 0037 기각안) 봉인 기준의 관측 시각을 그 대리로 쓴다 — 봉인되지 않은 회차는
    기준이 되지 못하므로, 그 회차에서 부르다 실패한 칸은 다음 회차가 더 오래된 기준과 비교해 다시 부른다.
    """
    elapsed = as_of - deadline_at
    if not timedelta(0) <= elapsed <= POST_DEADLINE_REFETCH_WINDOW:
        return False
    return elapsed // POST_DEADLINE_REFETCH_INTERVAL > (baseline_at - deadline_at) // POST_DEADLINE_REFETCH_INTERVAL
