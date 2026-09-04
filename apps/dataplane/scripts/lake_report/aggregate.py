"""모듈 책임: 파일별 관측 목록을 표본 수·코호트·계산 버전이 붙은 리포트 한 장으로 접는다.

집계는 순수 함수로 두어 레이크 없이 단위 검증한다. 어떤 값을 어떤 가중으로 셌는지가 다른 조사와의
대조에서 곧바로 문제가 되므로, 행 가중과 회차 가중을 모두 남기고 명단 규모 구간을 함께 낸다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal

from eatbid.source.eat.lineage import BID_HISTORY_DATASET
from eatbid.source.eat.reserve_price import P_LIST_DATASET
from eatbid.source.eat.roster import BID_LIST_DATASET
from lake_report.observe import (
    OBSERVED_BID_RATE_CEILING,
    PARSER_VERSION,
    FileObservation,
    RoundSummary,
    contract_bounds,
    decimal_or_none,
)

ROSTER_BANDS: tuple[tuple[str, int, int], ...] = (
    ("3~9", 3, 9),
    ("10~29", 10, 29),
    ("30~59", 30, 59),
    ("60~99", 60, 99),
    ("100+", 100, 1 << 30),
)
_MAX_LISTED_REASONS = 20
_MAX_REASON_EXAMPLES = 3


@dataclass(frozen=True, slots=True)
class LakeReport:
    calc_version: str
    parser_version: str
    generated_at: str
    lake_path: str
    lake_file_count: int
    lake_latest_mtime: str | None
    cohort: str
    sample_count: int
    normalized: int
    quarantined: int
    quarantine_reasons: tuple[tuple[str, int, tuple[str, ...]], ...]
    block_presence: Mapping[str, int]
    maxima: Mapping[str, Mapping[str, str]]
    bid_status_counts: tuple[tuple[str, int], ...]
    award_method_codes: tuple[tuple[str, int], ...]
    award_method_fields: tuple[tuple[str, int], ...]
    masked_amounts: Mapping[str, int]
    roster_sizes: Mapping[str, str]
    below_floor: Mapping[str, str]
    runner_up_gap: Mapping[str, str]
    band_metrics: tuple[tuple[str, int, str, str, str, str], ...]
    invariants: Mapping[str, int]
    period: Mapping[str, str]
    organization_count: int = 0
    rounds: tuple[RoundSummary, ...] = field(default=())


def median(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def percentile(values: Sequence[int], fraction: str) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = (Decimal(fraction) * Decimal(len(ordered))).to_integral_value(
        "ROUND_CEILING"
    )
    index = int(rank) - 1
    return ordered[max(0, min(index, len(ordered) - 1))]


def ratio_text(numerator: int, denominator: int) -> str:
    if denominator == 0:
        return "n/a"
    share = Decimal(numerator) * Decimal(100) / Decimal(denominator)
    return f"{share.quantize(Decimal('0.001'))}%"


def decimal_text(value: Decimal | None) -> str:
    return "n/a" if value is None else str(value)


def verdict(observed: str, contract: str) -> str:
    left = decimal_or_none(observed)
    right = decimal_or_none(contract)
    if left is None or right is None:
        return "n/a"
    return "상한 초과" if left > right else "상한 이내"


def aggregate(
    observations: Sequence[FileObservation],
    *,
    calc_version: str,
    lake_path: str,
    lake_file_count: int,
    lake_latest_mtime: str | None,
    cohort: str,
    generated_at: str | None = None,
) -> LakeReport:
    """관측 목록을 리포트 한 장으로 접는다."""
    normalized = [item for item in observations if item.normalized]
    opened = sorted(item.opened_on for item in observations if item.opened_on)
    return LakeReport(
        calc_version=calc_version,
        parser_version=PARSER_VERSION,
        generated_at=generated_at or datetime.now(UTC).isoformat(timespec="seconds"),
        lake_path=lake_path,
        lake_file_count=lake_file_count,
        lake_latest_mtime=lake_latest_mtime,
        cohort=cohort,
        sample_count=len(observations),
        normalized=len(normalized),
        quarantined=len(observations) - len(normalized),
        quarantine_reasons=_quarantine_reasons(observations),
        block_presence={
            BID_LIST_DATASET: sum(1 for item in observations if item.has_bid_list),
            P_LIST_DATASET: sum(1 for item in observations if item.has_p_list),
            BID_HISTORY_DATASET: sum(
                1 for item in observations if item.has_bid_history
            ),
        },
        maxima=_maxima(observations),
        bid_status_counts=_status_counts(observations),
        award_method_codes=_field_counts(
            observations, lambda item: item.award_method_code
        ),
        award_method_fields=_field_counts(
            observations, lambda item: item.award_method_field
        ),
        masked_amounts={
            "rows": sum(item.masked_amount_rows for item in observations),
            "withdrawn_rows": sum(item.masked_withdrawn_rows for item in observations),
            "files": sum(1 for item in observations if item.masked_amount_rows),
        },
        roster_sizes=_roster_sizes(observations),
        below_floor=_below_floor(normalized),
        runner_up_gap=_runner_up_gap(normalized),
        band_metrics=band_metrics(normalized),
        invariants={
            "multiple_award_rows": sum(
                1 for item in observations if item.award_rows > 1
            ),
            "award_below_floor": sum(
                1 for item in normalized if item.award_below_floor
            ),
            "draw_average_mismatch": sum(
                1 for item in observations if item.draw_average_mismatch
            ),
            "draw_average_checked": sum(
                1 for item in observations if item.draw_average_checked
            ),
        },
        period={
            "first_opened_on": opened[0] if opened else "n/a",
            "last_opened_on": opened[-1] if opened else "n/a",
        },
        organization_count=len(
            {item.organization_code for item in observations if item.organization_code}
        ),
    )


def _quarantine_reasons(
    observations: Sequence[FileObservation],
) -> tuple[tuple[str, int, tuple[str, ...]], ...]:
    reasons: Counter[str] = Counter()
    examples: dict[str, list[str]] = {}
    for item in observations:
        if item.normalized:
            continue
        reason = item.quarantine_reason or "unknown"
        reasons[reason] += 1
        listed = examples.setdefault(reason, [])
        if len(listed) < _MAX_REASON_EXAMPLES:
            listed.append(item.external_bid_id)
    return tuple(
        (reason, count, tuple(examples[reason]))
        for reason, count in reasons.most_common(_MAX_LISTED_REASONS)
    )


def _maxima(
    observations: Sequence[FileObservation],
) -> Mapping[str, Mapping[str, str]]:
    bounds = contract_bounds()
    rates = [
        value
        for value in (decimal_or_none(item.max_bid_rate) for item in observations)
        if value is not None
    ]

    def counted(name: str, values: Sequence[int]) -> Mapping[str, str]:
        return {
            "observed": str(max(values, default=0)),
            "contract": str(bounds[name]),
        }

    return {
        "roster_rows": counted(
            "roster_rows", [item.roster_rows for item in observations]
        ),
        "draw_numbers": counted(
            "max_draw_numbers", [item.max_draw_numbers for item in observations]
        ),
        "draw_candidates": counted(
            "draw_candidates", [item.draw_candidates for item in observations]
        ),
        "chain_links": counted(
            "chain_links", [item.chain_links for item in observations]
        ),
        "bid_rate": {
            "observed": decimal_text(max(rates, default=None)),
            "contract": str(OBSERVED_BID_RATE_CEILING),
        },
    }


def _status_counts(
    observations: Sequence[FileObservation],
) -> tuple[tuple[str, int], ...]:
    statuses: Counter[str] = Counter()
    for item in observations:
        statuses.update(dict(item.bid_status_counts))
    return tuple(statuses.most_common())


def _field_counts(
    observations: Sequence[FileObservation],
    read: Callable[[FileObservation], str | None],
) -> tuple[tuple[str, int], ...]:
    counts: Counter[str] = Counter()
    for item in observations:
        value = read(item)
        if value is not None:
            counts[value] += 1
    return tuple(counts.most_common(_MAX_LISTED_REASONS))


def _roster_sizes(observations: Sequence[FileObservation]) -> Mapping[str, str]:
    sizes = [item.roster_rows for item in observations if item.has_bid_list]
    mean = (
        (Decimal(sum(sizes)) / Decimal(len(sizes))).quantize(Decimal("0.1"))
        if sizes
        else None
    )
    return {
        "count": str(len(sizes)),
        "mean": decimal_text(mean),
        "median": decimal_text(median([Decimal(size) for size in sizes])),
        "p95": str(percentile(sizes, "0.95")),
        "max": str(max(sizes, default=0)),
    }


def _below_floor(normalized: Sequence[FileObservation]) -> Mapping[str, str]:
    """행 가중과 회차 가중을 모두 낸다.

    큰 명단일수록 하한 미만 비율이 높아 두 수가 크게 갈린다. 다른 조사와 대조하려면 어느 쪽으로
    센 값인지가 함께 있어야 하며, 하나만 남기면 나중에 재현할 수 없다(AGENTS 7).
    """
    below = sum(item.below_floor_rows for item in normalized)
    scored = sum(item.scored_rows for item in normalized)
    shares = [
        Decimal(item.below_floor_rows) * Decimal(100) / Decimal(item.scored_rows)
        for item in normalized
        if item.scored_rows
    ]
    mean = (
        (sum(shares, Decimal(0)) / Decimal(len(shares))).quantize(Decimal("0.001"))
        if shares
        else None
    )
    middle = median(shares)
    return {
        "rows": str(below),
        "scored_rows": str(scored),
        "ratio": ratio_text(below, scored),
        "auction_mean": decimal_text(mean),
        "auction_median": decimal_text(
            middle.quantize(Decimal("0.001")) if middle is not None else None
        ),
    }


def _runner_up_gap(normalized: Sequence[FileObservation]) -> Mapping[str, str]:
    gaps = sorted(
        value
        for value in (decimal_or_none(item.runner_up_gap) for item in normalized)
        if value is not None
    )
    return {
        "rounds": str(len(gaps)),
        "median": decimal_text(median(gaps)),
        "p25": decimal_text(median(gaps[: len(gaps) // 2])),
        "p75": decimal_text(median(gaps[(len(gaps) + 1) // 2 :])),
    }


def band_metrics(
    normalized: Sequence[FileObservation],
) -> tuple[tuple[str, int, str, str, str, str], ...]:
    """명단 규모 구간별로 낙찰률·하한 미만 비율·격차를 함께 낸다.

    다른 조사와의 코호트 차이는 명단 규모 분포 차이로 드러난다. 구간을 고정하면 두 표본의 같은
    구간끼리 비교할 수 있어 파서를 숫자에 맞추지 않고도 차이를 설명할 수 있다.
    """
    bands: list[tuple[str, int, str, str, str, str]] = []
    for label, low, high in ROSTER_BANDS:
        rounds = [item for item in normalized if low <= item.roster_rows <= high]
        rates = [
            value
            for value in (decimal_or_none(item.award_rate) for item in rounds)
            if value is not None
        ]
        gaps = [
            value
            for value in (decimal_or_none(item.runner_up_gap) for item in rounds)
            if value is not None
        ]
        below = sum(item.below_floor_rows for item in rounds)
        scored = sum(item.scored_rows for item in rounds)
        bands.append(
            (
                label,
                len(rounds),
                decimal_text(median(rates)),
                ratio_text(below, scored),
                decimal_text(median(gaps)),
                str(percentile([item.roster_rows for item in rounds], "0.95")),
            )
        )
    return tuple(bands)
