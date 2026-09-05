"""모듈 책임: 파일별 관측 목록을 표본 수·코호트·계산 버전이 붙은 리포트 한 장으로 접는다.

집계는 순수 함수로 두어 레이크 없이 단위 검증한다. 어떤 값을 어떤 가중으로 셌는지가 다른 조사와의
대조에서 곧바로 문제가 되므로, 행 가중과 회차 가중을 모두 남기고 명단 규모 구간을 함께 낸다. 정의를
갖는 파생 지표 계산은 `lake_report.derived`가 소유한다.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal

from eatbid.source.eat.lineage import BID_HISTORY_DATASET
from eatbid.source.eat.reserve_price import P_LIST_DATASET
from eatbid.source.eat.roster import BID_LIST_DATASET
from lake_report.derived import (
    MAX_LISTED_ROWS,
    band_metrics,
    below_floor,
    count_text,
    decimal_text,
    floor_rate_metrics,
    median,
    percentile,
    runner_up_gap,
)
from lake_report.observe import (
    OBSERVED_BID_RATE_CEILING,
    PARSER_VERSION,
    FileObservation,
    contract_bounds,
    decimal_or_none,
)
from lake_report.rounds import RoundsReport

_MAX_REASON_EXAMPLES = 3


@dataclass(frozen=True, slots=True)
class LakeReport:
    calc_version: str
    parser_version: str
    generated_at: str
    lake_path: str
    lake_file_count: int | None
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
    floor_rate_metrics: tuple[tuple[str, int, int, int, str], ...]
    band_metrics: tuple[tuple[str, int, str, str, str, str], ...]
    invariants: Mapping[str, int]
    # 관측하지 못한 값의 수다. 위반(`invariants`)과 같은 표에 두면 "결측이 있으면 잘못"으로 읽히는데,
    # 개찰 시각과 사업자번호는 소스가 보장하지 않는 값이라 결측 자체가 정상 관측이다(AGENTS 3).
    missing_observations: Mapping[str, int]
    period: Mapping[str, str]
    organization_count: int = 0
    # 기관 코드를 알 수 없는 파싱 실패는 어떤 코호트에도 속하지 못한다. 그 수를 0이라도 남겨야
    # 좁힌 실행의 격리 0건이 "격리가 없었다"로 잘못 읽히지 않는다.
    excluded_unknown_organization: int = 0
    rounds: RoundsReport | None = None


def aggregate(
    observations: Sequence[FileObservation],
    *,
    calc_version: str,
    lake_path: str,
    lake_file_count: int | None,
    lake_latest_mtime: str | None,
    cohort: str,
    generated_at: str | None = None,
    excluded_unknown_organization: int = 0,
    rounds: RoundsReport | None = None,
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
        below_floor=below_floor(normalized),
        runner_up_gap=runner_up_gap(normalized),
        floor_rate_metrics=floor_rate_metrics(normalized),
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
        missing_observations={
            # 분모는 정규화 성공분이다. 격리된 파일은 계약을 통과하지 못해 `schedule`이 없다.
            "normalized_rounds": len(normalized),
            "opened_at_missing_rounds": sum(
                1 for item in normalized if item.opened_at_missing
            ),
            # 명단 행 분모는 원본 파싱에 성공한 전부다. 정규화 격리와 무관하게 `ds_bidList` 행은
            # 세어지며, 승격 규칙이 적용될 모집단이 그것이다.
            "roster_rows": sum(item.roster_rows for item in observations),
            "business_number_missing_rows": sum(
                item.business_number_missing_rows for item in observations
            ),
        },
        period={
            "first_opened_on": opened[0] if opened else "n/a",
            "last_opened_on": opened[-1] if opened else "n/a",
        },
        organization_count=len(
            {item.organization_code for item in observations if item.organization_code}
        ),
        excluded_unknown_organization=excluded_unknown_organization,
        rounds=rounds,
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
        for reason, count in reasons.most_common(MAX_LISTED_ROWS)
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
    return tuple(counts.most_common(MAX_LISTED_ROWS))


def _roster_sizes(observations: Sequence[FileObservation]) -> Mapping[str, str]:
    sizes =[item.roster_rows for item in observations if item.has_bid_list]
    mean = (
        (Decimal(sum(sizes)) / Decimal(len(sizes))).quantize(Decimal("0.1"))
        if sizes
        else None
    )
    return {
        "count": str(len(sizes)),
        "mean": decimal_text(mean),
        "median": decimal_text(median([Decimal(size) for size in sizes])),
        "p95": count_text(percentile(sizes, "0.95")),
        "max": str(max(sizes, default=0)),
    }
