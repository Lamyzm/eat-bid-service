"""모듈 책임: 화면 설계가 쓴 회차 조사 JSON을 레이크 관측과 대조해 리포트 한 절로 만든다.

조사 파일에는 실제 사업자번호·업체명이 담긴 `bids` 배열이 있다. 이 모듈은 `bidId`·`winRate`·
`nBids` 셋만 읽고 그 밖의 키는 열지 않는다 — 대조에 필요 없는 업체 정체성을 리포트가 들고 다니지
않게 하려는 것이다(AGENTS 2·7).
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from lake_report.observe import FileObservation, RoundSummary, locate, observe_file

# 조사 파일의 낙찰률은 JSON 수이고 관측은 계약 정밀도의 문자열이다. 셋째 자리로 맞춰 문자열끼리
# 비교하면 float 비교를 리포트에 들이지 않는다.
_AWARD_RATE_DIGITS = 3


@dataclass(frozen=True, slots=True)
class RoundsReport:
    """회차 대조 결과. 공고 id와 개수만 담고 업체 정체성은 담지 않는다."""

    source: str
    organization_code: str
    listed: int
    matched: int
    mismatched: tuple[str, ...]
    quarantined: tuple[str, ...]
    missing: tuple[str, ...]
    organization_rounds: int
    summaries: tuple[RoundSummary, ...]


def read_rounds(source: Path) -> dict[str, tuple[str, int]]:
    """조사 파일에서 공고 id별 기대 낙찰률·명단 수만 읽는다."""
    rows = json.loads(source.read_text(encoding="utf-8"))
    return {
        str(row["bidId"]): (
            f"{float(row['winRate']):.{_AWARD_RATE_DIGITS}f}",
            int(row["nBids"]),
        )
        for row in rows
    }


def summarize_rounds(
    lake: Path, *, external_bid_ids: tuple[str, ...]
) -> dict[str, RoundSummary]:
    """회차별 낙찰률과 명단 수만 낸다. 격리된 회차는 담기지 않으므로 호출자가 차집합을 본다."""
    summaries, _missing, _quarantined = _observe_rounds(lake, external_bid_ids)
    return summaries


def compare_rounds(
    lake: Path,
    *,
    source: Path,
    organization_code: str,
    observations: Sequence[FileObservation],
) -> RoundsReport:
    """조사값과 관측을 대조하고, 이번 실행 표본에서 그 기관의 회차 수를 함께 센다.

    대조는 표본과 무관하게 조사 파일이 지목한 공고만 다시 관측한다. `--limit`이나 기관 필터로 좁힌
    실행에서도 대조가 성립해야 하며, 표본에 그 공고가 없다는 사실을 대조 실패로 읽으면 안 된다.
    """
    expected = read_rounds(source)
    summaries, missing, quarantined = _observe_rounds(lake, tuple(expected))
    mismatched = tuple(
        bid_id
        for bid_id, summary in summaries.items()
        if (summary.award_rate, summary.roster_size) != expected[bid_id]
    )
    return RoundsReport(
        source=str(source),
        organization_code=organization_code,
        listed=len(expected),
        matched=len(summaries) - len(mismatched),
        mismatched=mismatched,
        quarantined=quarantined,
        missing=missing,
        organization_rounds=sum(
            1
            for item in observations
            if item.organization_code == organization_code and item.normalized
        ),
        summaries=tuple(summaries.values()),
    )


def _observe_rounds(
    lake: Path, external_bid_ids: tuple[str, ...]
) -> tuple[dict[str, RoundSummary], tuple[str, ...], tuple[str, ...]]:
    """레이크에 없는 회차와 격리된 회차를 나눠 돌려준다. 둘은 다른 사실이다."""
    summaries: dict[str, RoundSummary] = {}
    missing: list[str] = []
    quarantined: list[str] = []
    for external_bid_id in external_bid_ids:
        path = locate(lake, external_bid_id)
        if path is None:
            missing.append(external_bid_id)
            continue
        observation = observe_file(str(path))
        if not observation.normalized:
            quarantined.append(external_bid_id)
            continue
        summaries[external_bid_id] = RoundSummary(
            external_bid_id=external_bid_id,
            award_rate=observation.award_rate,
            roster_size=observation.roster_rows,
        )
    return summaries, tuple(missing), tuple(quarantined)
