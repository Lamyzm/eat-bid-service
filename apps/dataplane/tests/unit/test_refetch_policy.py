from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
from hypothesis import given
from hypothesis import strategies as st

from eatbid.generated.ingestion_v1 import InstantText
from eatbid.pipeline.refetch_policy import (
    POST_DEADLINE_REFETCH_WINDOW,
    DetailSelection,
    ListSignal,
    RefetchBaseline,
    select_detail_refetch,
)
from eatbid.source.eat.models import BidListRow

BASELINE_ID = UUID("37000000-0000-0000-0000-000000000001")
BASELINE_AT = datetime(2026, 9, 7, 0, 0, tzinfo=UTC)
AS_OF = BASELINE_AT + timedelta(minutes=30)
DEADLINE = datetime(2026, 9, 14, 1, 0, tzinfo=UTC)
LAST_CHANGED = datetime(2026, 9, 2, 8, 59, 56, tzinfo=UTC)


def _행(
    bid_id: str,
    *,
    competitor_count: int = 3,
    status_name: str = "진행중",
    deadline_at: datetime = DEADLINE,
    last_changed_at: datetime = LAST_CHANGED,
) -> BidListRow:
    return BidListRow(
        external_bid_id=bid_id,
        competitor_count=competitor_count,
        status_name=status_name,
        deadline_at=InstantText(root=deadline_at.strftime("%Y-%m-%dT%H:%M:%SZ")),
        last_changed_at=InstantText(
            root=last_changed_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        ),
    )


def _기준(*rows: BidListRow, observed_at: datetime = BASELINE_AT) -> RefetchBaseline:
    return RefetchBaseline(
        source_release_id=BASELINE_ID,
        observed_at=observed_at,
        signals={row.external_bid_id: ListSignal.from_row(row) for row in rows},
    )


def _선택(
    rows: tuple[BidListRow, ...],
    baseline: RefetchBaseline | None,
    *,
    as_of: datetime = AS_OF,
) -> DetailSelection:
    return select_detail_refetch(rows, mode="poll-open", baseline=baseline, as_of=as_of)


def test_기준과_네_신호가_모두_같으면_상세를_다시_부르지_않는다() -> None:
    row = _행("1")

    selection = _선택((row,), _기준(row))

    assert selection.external_bid_ids == ()
    assert selection.unchanged_count == 1
    assert selection.reason_counts() == {"unchanged": 1}
    assert selection.baseline_source_release_id == BASELINE_ID


@pytest.mark.parametrize(
    "changed",
    [
        {"competitor_count": 4},
        {"status_name": "입찰마감"},
        {"deadline_at": DEADLINE + timedelta(days=1)},
        {"last_changed_at": LAST_CHANGED + timedelta(hours=1)},
    ],
    ids=["BID_CNT", "ETN_BID_STT_NM", "BID_END_DT", "LAST_CHG_DT"],
)
def test_네_신호_중_하나라도_바뀌면_상세를_다시_부른다(
    changed: dict[str, object],
) -> None:
    before = _행("1")
    after = _행("1", **changed)  # type: ignore[arg-type]

    selection = _선택((after,), _기준(before))

    assert selection.external_bid_ids == ("1",)
    assert selection.reasons == {"1": "signal-changed"}


def test_BID_CNT가_올라도_LAST_CHG_DT가_그대로인_공고를_놓치지_않는다() -> None:
    # 2026-09-06 실측: 참여가 늘어난 7건 모두 LAST_CHG_DT가 그대로였다.
    before = _행("5796627", competitor_count=7)
    after = _행("5796627", competitor_count=8)

    assert _선택((after,), _기준(before)).reasons == {"5796627": "signal-changed"}


def test_기준에_없던_공고는_새_공고로_부른다() -> None:
    selection = _선택((_행("1"), _행("2")), _기준(_행("1")))

    assert selection.external_bid_ids == ("2",)
    assert selection.reasons == {"2": "new"}
    assert selection.unchanged_count == 1


def test_기준_관측_뒤_마감이_지났으면_신호가_같아도_부른다() -> None:
    deadline = BASELINE_AT + timedelta(minutes=10)
    row = _행("1", deadline_at=deadline)

    selection = _선택((row,), _기준(row), as_of=BASELINE_AT + timedelta(days=3))

    assert selection.reasons == {"1": "deadline-passed"}


def test_마감_뒤_창_안에서는_신호가_같아도_회차마다_부른다() -> None:
    deadline = BASELINE_AT - timedelta(hours=1)
    row = _행("1", deadline_at=deadline)

    inside = _선택((row,), _기준(row), as_of=deadline + POST_DEADLINE_REFETCH_WINDOW)
    outside = _선택(
        (row,),
        _기준(row),
        as_of=deadline + POST_DEADLINE_REFETCH_WINDOW + timedelta(seconds=1),
    )

    assert inside.reasons == {"1": "post-deadline-window"}
    assert outside.external_bid_ids == ()


def test_마감이_아직_오지_않은_공고는_마감_규칙에_걸리지_않는다() -> None:
    row = _행("1", deadline_at=AS_OF + timedelta(minutes=1))

    assert _선택((row,), _기준(row)).external_bid_ids == ()


def test_기준이_없으면_전부_부르고_기준_release를_남기지_않는다() -> None:
    selection = _선택((_행("2"), _행("10")), None)

    assert selection.external_bid_ids == ("2", "10")
    assert selection.reason_counts() == {"no-baseline": 2, "unchanged": 0}
    assert selection.baseline_source_release_id is None


def test_좁히지_않는_모드는_기준이_있어도_전부_부른다() -> None:
    row = _행("1")

    selection = select_detail_refetch(
        (row,), mode="daily-reconcile", baseline=_기준(row), as_of=AS_OF
    )

    assert selection.reasons == {"1": "full-mode"}
    assert selection.baseline_source_release_id is None


def test_선택_ID는_숫자_순서로_정렬된다() -> None:
    selection = _선택((_행("10"), _행("9"), _행("100")), None)

    assert selection.external_bid_ids == ("9", "10", "100")


def test_naive_as_of는_거부한다() -> None:
    with pytest.raises(ValueError, match="timezone-aware"):
        _선택((_행("1"),), None, as_of=datetime(2026, 9, 7))  # noqa: DTZ001


def test_선택과_이유는_일대일이어야_한다() -> None:
    with pytest.raises(ValueError, match="exactly one reason"):
        DetailSelection(
            external_bid_ids=("1",),
            reasons={},
            unchanged_count=0,
            baseline_source_release_id=None,
        )


_counts = st.integers(min_value=0, max_value=200)
_ids = st.lists(
    st.integers(min_value=1, max_value=10_000).map(str),
    min_size=0,
    max_size=30,
    unique=True,
)


@given(
    ids=_ids,
    counts=st.lists(_counts, min_size=30, max_size=30),
    flips=st.lists(st.booleans(), min_size=30, max_size=30),
)
def test_선택은_목록의_부분집합이고_건너뛴_수와_합이_목록_크기다(
    ids: list[str], counts: list[int], flips: list[bool]
) -> None:
    baseline_rows = tuple(
        _행(bid_id, competitor_count=count)
        for bid_id, count in zip(ids, counts, strict=False)
    )
    current_rows = tuple(
        replace_count(row, row.competitor_count + 1) if flip else row
        for row, flip in zip(baseline_rows, flips, strict=False)
    )

    selection = _선택(current_rows, _기준(*baseline_rows))

    assert set(selection.external_bid_ids) <= {
        row.external_bid_id for row in current_rows
    }
    assert len(selection.external_bid_ids) + selection.unchanged_count == len(
        current_rows
    )
    expected = {
        row.external_bid_id
        for row, flip in zip(baseline_rows, flips, strict=False)
        if flip
    }
    assert set(selection.external_bid_ids) == expected


def replace_count(row: BidListRow, competitor_count: int) -> BidListRow:
    return _행(
        row.external_bid_id,
        competitor_count=competitor_count,
        status_name=row.status_name,
        deadline_at=datetime.fromisoformat(row.deadline_at.root),
        last_changed_at=datetime.fromisoformat(row.last_changed_at.root),
    )


def test_dataclass_replace로_기준을_옮겨도_관측_시각은_aware여야_한다() -> None:
    baseline = _기준(_행("1"))
    with pytest.raises(ValueError, match="timezone-aware"):
        replace(baseline, observed_at=datetime(2026, 9, 7))  # noqa: DTZ001
