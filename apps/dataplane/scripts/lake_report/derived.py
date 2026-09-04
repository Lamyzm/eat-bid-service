"""모듈 책임: 관측에서 리포트가 다시 세는 파생 지표(하한 미만, 1·2등 격차, 명단 규모 구간, 하한율별
분해)와 그 계산에 쓰는 분포 통계를 소유한다.

집계 전체에서 분리한 이유는 두 가지가 함께 바뀌지 않기 때문이다. 실행 사실·격리·블록 보유율은 원본이
어떻게 생겼는지를 세고, 여기 있는 값들은 "무엇을 무엇으로 나눴는가"라는 정의를 갖는다. 정의가 바뀌면
문서의 숫자 의미가 바뀌므로 그 경계를 파일로 나눠 둔다.

이 모듈의 백분위는 전부 ROUND_CEILING 최근접 순위이며, 명단 행은 취소(`WITHDRAWAL_YN=Y`) 행을
포함한다. 두 정의는 렌더가 문서에 함께 적는다(AGENTS 7).
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from decimal import Decimal

from lake_report.observe import FileObservation, decimal_or_none

ROSTER_BANDS: tuple[tuple[str, int, int], ...] = (
    ("3~9", 3, 9),
    ("10~29", 10, 29),
    ("30~59", 30, 59),
    ("60~99", 60, 99),
    ("100+", 100, 1 << 30),
)
UNOBSERVED_FLOOR_RATE = "하한율 미관측"
MAX_LISTED_ROWS = 20
# 백분위 정의는 한 곳에만 둔다. 같은 문서에서 p95와 사분위가 다른 규칙으로 계산되면 재현이 깨진다.
_QUARTILE_LOW = "0.25"
_QUARTILE_HIGH = "0.75"


def median(values: Sequence[Decimal]) -> Decimal | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2 == 1:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / Decimal(2)


def percentile[Ordered: (int, Decimal)](
    values: Sequence[Ordered], fraction: str
) -> Ordered | None:
    """ROUND_CEILING 최근접 순위. 정수(명단 규모)와 Decimal(격차)에 같은 정의를 쓴다."""
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


def count_text(value: int | None) -> str:
    """표본이 없어 값이 없는 칸은 `None`이 아니라 다른 없는 값과 같은 표기를 쓴다."""
    return "n/a" if value is None else str(value)


def verdict(observed: str, contract: str) -> str:
    left = decimal_or_none(observed)
    right = decimal_or_none(contract)
    if left is None or right is None:
        return "n/a"
    return "상한 초과" if left > right else "상한 이내"


def below_floor(normalized: Sequence[FileObservation]) -> Mapping[str, str]:
    """행 가중과 회차 가중을 모두 낸다.

    큰 명단일수록 하한 미만 비율이 높아 두 수가 크게 갈린다. 다른 조사와 대조하려면 어느 쪽으로
    센 값인지가 함께 있어야 하며, 하나만 남기면 나중에 재현할 수 없다(AGENTS 7).
    """
    below = sum(item.below_floor_rows for item in normalized)
    rows = sum(item.roster_rows for item in normalized)
    shares = [
        Decimal(item.below_floor_rows) * Decimal(100) / Decimal(item.roster_rows)
        for item in normalized
        if item.roster_rows
    ]
    mean = (
        (sum(shares, Decimal(0)) / Decimal(len(shares))).quantize(Decimal("0.001"))
        if shares
        else None
    )
    middle = median(shares)
    return {
        "rows": str(below),
        "roster_rows": str(rows),
        "ratio": ratio_text(below, rows),
        "auction_mean": decimal_text(mean),
        "auction_median": decimal_text(
            middle.quantize(Decimal("0.001")) if middle is not None else None
        ),
    }


def runner_up_gap(normalized: Sequence[FileObservation]) -> Mapping[str, str]:
    gaps = sorted(
        value
        for value in (decimal_or_none(item.runner_up_gap) for item in normalized)
        if value is not None
    )
    return {
        "rounds": str(len(gaps)),
        "median": decimal_text(median(gaps)),
        "p25": decimal_text(percentile(gaps, _QUARTILE_LOW)),
        "p75": decimal_text(percentile(gaps, _QUARTILE_HIGH)),
    }


def floor_rate_metrics(
    normalized: Sequence[FileObservation],
) -> tuple[tuple[str, int, int, int, str], ...]:
    """하한율값별로 회차·명단 행·하한 미만 행·비율을 낸다.

    하한율은 공고마다 다르므로(`PLNPRCE_SUCBD_STD`) 전체 하한 미만 비율 하나만으로는 그것이 무엇의
    평균인지 알 수 없다. 하한율을 관측하지 못한 공고는 하한 미만을 0으로 세므로 따로 세워 그 사실이
    비율에 섞이지 않게 한다.
    """
    rounds: Counter[str] = Counter()
    rows: Counter[str] = Counter()
    below: Counter[str] = Counter()
    for item in normalized:
        key = item.floor_rate or UNOBSERVED_FLOOR_RATE
        rounds[key] += 1
        rows[key] += item.roster_rows
        below[key] += item.below_floor_rows
    return tuple(
        (key, count, rows[key], below[key], ratio_text(below[key], rows[key]))
        for key, count in rounds.most_common(MAX_LISTED_ROWS)
    )


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
        rows = sum(item.roster_rows for item in rounds)
        bands.append(
            (
                label,
                len(rounds),
                decimal_text(median(rates)),
                ratio_text(below, rows),
                decimal_text(median(gaps)),
                count_text(percentile([item.roster_rows for item in rounds], "0.95")),
            )
        )
    return tuple(bands)
