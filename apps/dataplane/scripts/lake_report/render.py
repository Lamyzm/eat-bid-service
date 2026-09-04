"""모듈 책임: 리포트 값을 증거 문서의 Markdown 표로 옮기고, 사람이 쓴 결론 절을 재실행에서 지키다.

표의 구성과 절 이름은 증거 문서가 무엇을 주장하는지를 정하므로 집계와 따로 바뀐다. 원본 payload나
업체 정체성은 여기에 실리지 않고 집계·분포·개수만 실린다.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from pathlib import Path

from lake_report.aggregate import LakeReport
from lake_report.derived import ratio_text, verdict
from lake_report.rounds import RoundsReport

# 증거 문서의 결론은 사람이 쓴다. 표만 다시 만들 때 그 절이 사라지면 판단이 재실행 한 번에 지워지므로
# 이 표시 뒤쪽은 손대지 않고 그대로 잇는다.
CONCLUSION_MARKER = "\n---\n\n## 결론"


def table(header: Sequence[str], rows: Iterable[Sequence[str]]) -> str:
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("--" for _ in header) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in rows)
    return "\n".join(lines)


def existing_conclusion(output: Path) -> str:
    if not output.is_file():
        return ""
    previous = output.read_text(encoding="utf-8")
    index = previous.find(CONCLUSION_MARKER)
    return previous[index:] if index >= 0 else ""


def render_markdown(report: LakeReport) -> str:
    sections = [
        f"# eat-v2 전수 재정규화 리포트 ({report.calc_version})",
        "",
        _run_table(report),
        "",
        "## 격리",
        "",
        table(
            ["항목", "값"],
            [
                ["정규화 성공", f"{report.normalized:,}"],
                ["격리", f"{report.quarantined:,}"],
                ["격리율", ratio_text(report.quarantined, report.sample_count)],
            ],
        ),
        "",
        table(
            ["사유", "건수", "예시 공고 id"],
            [
                [reason, f"{count:,}", ", ".join(ids)]
                for reason, count, ids in report.quarantine_reasons
            ],
        ),
        "",
        "## 블록 보유율",
        "",
        table(
            ["dataset", "있음", "없음", "보유율"],
            [
                [
                    name,
                    f"{count:,}",
                    f"{report.sample_count - count:,}",
                    ratio_text(count, report.sample_count),
                ]
                for name, count in report.block_presence.items()
            ],
        ),
        "",
        "## 관측 최대값과 계약 상한",
        "",
        table(
            ["항목", "관측 최대", "계약 상한", "판정"],
            [
                [
                    name,
                    values["observed"],
                    values["contract"],
                    verdict(values["observed"], values["contract"]),
                ]
                for name, values in report.maxima.items()
            ],
        ),
        "",
        "## 명단 규모",
        "",
        table(
            ["표본", "평균", "중앙", "p95", "최대"],
            [
                [
                    report.roster_sizes["count"],
                    report.roster_sizes["mean"],
                    report.roster_sizes["median"],
                    report.roster_sizes["p95"],
                    report.roster_sizes["max"],
                ]
            ],
        ),
        "",
        "## 판정 코드 BID_STT 분포",
        "",
        table(
            ["코드", "행 수"],
            [
                [code or "(빈값)", f"{count:,}"]
                for code, count in report.bid_status_counts
            ],
        ),
        "",
        "## 낙찰 방식 코드",
        "",
        table(
            ["ds_info column", "파일 수"],
            [[name, f"{count:,}"] for name, count in report.award_method_fields],
        ),
        "",
        table(
            ["코드", "파일 수"],
            [[code, f"{count:,}"] for code, count in report.award_method_codes],
        ),
        "",
        "## BID_CALC_AMT 자리표시자",
        "",
        table(
            ["항목", "값"],
            [
                ["1조 초과 명단 행", f"{report.masked_amounts['rows']:,}"],
                [
                    "그중 WITHDRAWAL_YN=Y",
                    f"{report.masked_amounts['withdrawn_rows']:,}",
                ],
                ["해당 행을 가진 공고", f"{report.masked_amounts['files']:,}"],
            ],
        ),
        "",
        "## 파생 지표 (리포트의 계산이며 정규화 모델의 필드가 아니다)",
        "",
        "명단 행은 취소(`WITHDRAWAL_YN=Y`) 행을 포함한다. 백분위는 ROUND_CEILING 최근접 순위다.",
        "",
        _derived_table(report),
        "",
        "### 하한율별 분해 (회차 수 상위 20)",
        "",
        table(
            ["하한율", "회차", "명단 행", "하한 미만 행", "하한 미만 비율(행 가중)"],
            [
                [rate, f"{rounds:,}", f"{rows:,}", f"{below:,}", share]
                for rate, rounds, rows, below, share in report.floor_rate_metrics
            ],
        ),
        "",
        table(
            ["명단 규모", "회차", "낙찰률 중앙", "하한 미만 비율", "격차 중앙", "명단 p95"],
            [
                [label, f"{count:,}", rate, share, gap, p95]
                for label, count, rate, share, gap, p95 in report.band_metrics
            ],
        ),
        "",
        "## 불변식",
        "",
        table(
            ["불변식", "위반 수"],
            [[name, f"{count:,}"] for name, count in report.invariants.items()],
        ),
        "",
    ]
    if report.rounds is not None:
        sections.extend(_rounds_sections(report.rounds))
    return "\n".join(sections)


def _rounds_sections(rounds: RoundsReport) -> list[str]:
    """조사 파일과의 대조 결과를 절 하나로 만든다. 공고 id와 개수만 싣는다."""
    return [
        "## 회차 조사 대조",
        "",
        table(
            ["항목", "값"],
            [
                ["조사 파일", f"`{rounds.source}`"],
                ["조사 회차", f"{rounds.listed:,}"],
                ["조사값과 일치", f"{rounds.matched:,}"],
                ["불일치 공고 id", ", ".join(rounds.mismatched) or "없음"],
                ["격리된 공고 id", ", ".join(rounds.quarantined) or "없음"],
                ["레이크에 없는 공고 id", ", ".join(rounds.missing) or "없음"],
                [
                    f"이번 표본에서 구매기관 {rounds.organization_code} 회차",
                    f"{rounds.organization_rounds:,}",
                ],
            ],
        ),
        "",
        table(
            ["공고 id", "낙찰률", "명단 수"],
            [
                [item.external_bid_id, item.award_rate or "n/a", str(item.roster_size)]
                for item in rounds.summaries
            ],
        ),
        "",
    ]


def _run_table(report: LakeReport) -> str:
    period = f"{report.period['first_opened_on']} ~ {report.period['last_opened_on']}"
    # 레이크 전체 stat은 전수 실행에서만 계산한다(23만 회 stat). 좁힌 실행에서 빈 값을 n/a로 적으면
    # 관측하지 못한 것처럼 읽히므로 생략한 이유를 그 자리에 적는다.
    skipped = "코호트 실행이라 생략"
    return table(
        ["항목", "값"],
        [
            ["산출 시각(UTC)", report.generated_at],
            ["계산 버전", report.calc_version],
            ["파서 버전", report.parser_version],
            ["레이크 경로", f"`{report.lake_path}`"],
            [
                "레이크 파일 수",
                f"{report.lake_file_count:,}"
                if report.lake_file_count is not None
                else skipped,
            ],
            ["레이크 최신 mtime(UTC)", report.lake_latest_mtime or skipped],
            ["코호트", report.cohort],
            ["표본 수", f"{report.sample_count:,}"],
            [
                "기관 미상이라 코호트에서 제외된 파싱 실패",
                f"{report.excluded_unknown_organization:,}",
            ],
            ["개찰 기간", period],
            ["구매기관 수", f"{report.organization_count:,}"],
        ],
    )


def _derived_table(report: LakeReport) -> str:
    return table(
        ["항목", "값"],
        [
            ["하한 미만 행", report.below_floor["rows"]],
            ["명단 행(비율의 분모)", report.below_floor["roster_rows"]],
            ["하한 미만 비율(행 가중)", report.below_floor["ratio"]],
            ["하한 미만 비율(회차 평균)", f"{report.below_floor['auction_mean']}%"],
            ["하한 미만 비율(회차 중앙)", f"{report.below_floor['auction_median']}%"],
            ["격차 표본 회차", report.runner_up_gap["rounds"]],
            ["1·2등 격차 중앙", report.runner_up_gap["median"]],
            ["격차 1사분위", report.runner_up_gap["p25"]],
            ["격차 3사분위", report.runner_up_gap["p75"]],
        ],
    )
