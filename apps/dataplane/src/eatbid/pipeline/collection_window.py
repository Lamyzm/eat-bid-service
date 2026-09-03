"""모듈 책임: 수집 모드를 검토된 근거에 따라 eaT 목록 조회의 날짜 창으로 번역한다."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, get_args
from zoneinfo import ZoneInfo

from eatbid.ingest.repository import CaptureRunMode

_SEOUL_TIME = ZoneInfo("Asia/Seoul")
_EAT_DATE_WIRE = "%Y%m%d"
# 왜 6일인가. 2026-09-03 실측(docs/evidence/source-boundary/2026-09-03-collection-mode-windows.md)에서
# 마감 뒤 소스 변경(LAST_CHG_DT)은 +5일에서 완전히 멎었다. 오늘을 포함한 7일 창은 관측된 최대치에
# 이틀의 여유를 둔다. 표본은 8월 하순 한 주뿐이므로 다른 학기 구간의 꼬리는 재검토 대상이다.
DAILY_RECONCILE_LOOKBACK = timedelta(days=6)

ScheduledMode = Literal["poll-open", "daily-reconcile"]
COLLECTION_MODES: tuple[CaptureRunMode, ...] = get_args(CaptureRunMode)


@dataclass(frozen=True, slots=True)
class CollectionWindow:
    """eaT `P_BID_BGNG_DT`/`P_BID_END_DT`에 그대로 들어가는 yyyyMMdd 포함 구간이다."""

    start_date: str
    end_date: str


def resolve_collection_window(
    mode: str,
    *,
    as_of: datetime,
    start_date: str = "",
    end_date: str = "",
) -> CollectionWindow:
    """모드와 기준 시각으로 창을 정한다.

    창 의미는 입찰기간 겹침 필터이므로(같은 evidence 문서 §1) `poll-open`은 오늘 하루만으로 지금
    열린 공고 전부를 얻는다. `backfill`은 사람이 지정한 구간만 받으며, 예약 모드에 구간을 함께 주면
    모드와 인자가 서로 다른 말을 하는 것이므로 추측하지 않고 거부한다.
    """
    if mode not in COLLECTION_MODES:
        raise ValueError(f"unknown collection mode: {mode}")
    if as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    if mode == "backfill":
        if not start_date or not end_date:
            raise ValueError("backfill requires explicit --start-date and --end-date")
        return CollectionWindow(start_date=start_date, end_date=end_date)
    if start_date or end_date:
        raise ValueError(f"{mode} derives its window from --as-of; do not pass dates")
    # eaT 날짜는 서울 달력 날짜이므로 UTC instant를 서울로 옮긴 뒤 날짜를 취한다.
    today = as_of.astimezone(_SEOUL_TIME).date()
    if mode == "poll-open":
        start = today
    else:
        start = today - DAILY_RECONCILE_LOOKBACK
    return CollectionWindow(
        start_date=start.strftime(_EAT_DATE_WIRE),
        end_date=today.strftime(_EAT_DATE_WIRE),
    )
