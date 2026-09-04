"""`lake_report.aggregate`와 `lake_report.derived`의 순수 집계를 레이크 없이 고정한다.

리포트 스크립트는 `eatbid` 패키지 밖의 독립 실행 파일이라 scripts 디렉터리를 얹고 불러온다.
"""

from __future__ import annotations

import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

SCRIPTS_ROOT = Path(__file__).parents[2] / "scripts"
if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from lake_report.aggregate import LakeReport, aggregate
from lake_report.derived import band_metrics, median, percentile, verdict
from lake_report.observe import FileObservation


def _observation(**overrides: Any) -> FileObservation:
    defaults: dict[str, Any] = {
        "external_bid_id": "1",
        "normalized": True,
        "has_bid_list": True,
        "has_p_list": True,
        "roster_rows": 10,
        "opened_on": "2025-01-01",
        "organization_code": "153045",
    }
    defaults.update(overrides)
    return FileObservation(**defaults)


def _aggregate(observations: list[FileObservation]) -> LakeReport:
    return aggregate(
        observations,
        calc_version="test",
        lake_path="lake",
        lake_file_count=len(observations),
        lake_latest_mtime=None,
        cohort="단위 테스트",
        generated_at="2026-09-04T00:00:00+00:00",
    )


def test_격리_사유는_건수_내림차순으로_예시_공고를_셋까지만_담는다() -> None:
    observations = [
        _observation(
            external_bid_id=str(index), normalized=False, quarantine_reason="상한"
        )
        for index in range(5)
    ] + [_observation(external_bid_id="9", normalized=False, quarantine_reason="파싱")]

    report = _aggregate(observations)

    assert report.sample_count == 6
    assert report.normalized == 0
    assert report.quarantined == 6
    assert report.quarantine_reasons[0] == ("상한", 5, ("0", "1", "2"))
    assert report.quarantine_reasons[1] == ("파싱", 1, ("9",))


def test_관측_최대값은_격리된_파일의_값도_계약_상한과_함께_남긴다() -> None:
    observations = [
        _observation(
            external_bid_id="1",
            normalized=False,
            quarantine_reason="상한",
            max_bid_rate="101.975",
            roster_rows=413,
        ),
        _observation(external_bid_id="2", max_bid_rate="90.000", roster_rows=10),
    ]

    report = _aggregate(observations)

    assert report.maxima["bid_rate"]["observed"] == "101.975"
    assert report.maxima["bid_rate"]["contract"] == "999999999999.999"
    assert report.maxima["roster_rows"]["observed"] == "413"
    assert verdict("101.975", "999999999999.999") == "상한 이내"
    assert verdict("1000000000000.000", "999999999999.999") == "상한 초과"
    assert verdict("413", "2048") == "상한 이내"


def test_하한_미만_비율은_행_가중과_회차_가중을_모두_남긴다() -> None:
    observations = [
        _observation(
            external_bid_id="1",
            below_floor_rows=1,
            roster_rows=10,
            runner_up_gap="0.100",
        ),
        _observation(
            external_bid_id="2",
            below_floor_rows=9,
            roster_rows=10,
            runner_up_gap="0.200",
        ),
        _observation(
            external_bid_id="3",
            normalized=False,
            quarantine_reason="상한",
            below_floor_rows=99,
            roster_rows=99,
        ),
    ]

    report = _aggregate(observations)

    assert report.below_floor["rows"] == "10"
    assert report.below_floor["roster_rows"] == "20"
    assert report.below_floor["ratio"] == "50.000%"
    assert report.below_floor["auction_mean"] == "50.000"
    assert report.runner_up_gap["rounds"] == "2"
    assert report.runner_up_gap["median"] == "0.150"


def test_사분위도_백분위와_같은_최근접_순위_정의를_쓴다() -> None:
    gaps = ["0.100", "0.200", "0.300", "0.400"]
    observations = [
        _observation(external_bid_id=str(index), runner_up_gap=gap)
        for index, gap in enumerate(gaps)
    ]

    report = _aggregate(observations)

    # ROUND_CEILING 최근접 순위: 4개 표본의 25%는 1번째, 75%는 3번째다. 반쪽 중앙값(Tukey hinge)과
    # 다른 값이 나오므로 정의가 하나로 모였는지가 여기서 드러난다.
    assert report.runner_up_gap["p25"] == "0.100"
    assert report.runner_up_gap["median"] == "0.250"
    assert report.runner_up_gap["p75"] == "0.300"


def test_명단_규모_구간은_회차가_없어도_행을_남긴다() -> None:
    bands = band_metrics(
        [
            _observation(
                external_bid_id="1",
                roster_rows=5,
                award_rate="90.500",
                below_floor_rows=1,
                runner_up_gap="0.400",
            ),
            _observation(
                external_bid_id="2",
                roster_rows=120,
                award_rate="90.010",
                below_floor_rows=60,
                runner_up_gap="0.010",
            ),
        ]
    )

    assert [label for label, *_rest in bands] == ["3~9", "10~29", "30~59", "60~99", "100+"]
    assert bands[0] == ("3~9", 1, "90.500", "20.000%", "0.400", "5")
    assert bands[1] == ("10~29", 0, "n/a", "n/a", "n/a", "n/a")
    assert bands[4] == ("100+", 1, "90.010", "50.000%", "0.010", "120")


def test_중앙값과_백분위는_빈_표본에서_없음을_돌려준다() -> None:
    assert median([]) is None
    assert percentile([], "0.95") is None
    assert median([Decimal(1), Decimal(2), Decimal(4)]) == Decimal(2)
    assert percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "0.95") == 10
