"""모듈 책임: EAT-46이 남긴 목록 미확인 항목(재공고 표시·PAGE_SIZE 상한·backfill 분할 단위)을
읽기 전용 관측으로 닫는다.

왜 `probe_eat_list.py`와 나누나. 그 스크립트는 창 의미와 페이지 계약이라는 이미 닫힌 질문의 재현
명령이고, 여기 있는 셋은 아직 답이 없는 질문이다. 한 파일에 섞으면 "무엇이 확정이고 무엇이 조사
중인가"가 파일 안에서 사라진다. 두 스크립트 모두 아무것도 저장하지 않는다.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter
from collections.abc import Mapping, Sequence
from datetime import date

from eat_probe import fetch_page, fetch_with_raw_page_size, parse_rows, total_count

REBID_SUFFIX = "[재입찰]"
# 목록은 상세의 `ELCTRN_BID_NO`를 `ETN_BID_NO`라는 이름으로 돌려준다. 상세 어휘를 그대로 찾으면
# 없다는 오답이 나오므로 목록 쪽 이름을 쓴다.
_BID_NO_FIELD = "ETN_BID_NO"


def _has_rebid_suffix(row: Mapping[str, str]) -> bool:
    return row.get("BID_NM", "").rstrip().endswith(REBID_SUFFIX)


def _chain_base(row: Mapping[str, str]) -> str:
    """`E260825-658104-1`에서 차수를 뗀 `E260825-658104`가 사슬 기준선이라는 가설을 검사할 키다."""
    return row.get(_BID_NO_FIELD, "").rpartition("-")[0]


def _report_chains(rows: Sequence[Mapping[str, str]]) -> None:
    """같은 창 안에서 번호 기준선이 겹치는 행을 찾아 목록만으로 사슬이 보이는지 확인한다."""
    grouped: dict[str, list[Mapping[str, str]]] = {}
    for row in rows:
        grouped.setdefault(_chain_base(row), []).append(row)
    shared = {base: group for base, group in grouped.items() if len(group) > 1}
    print(f"  같은 번호 기준선이 창 안에 둘 이상: {len(shared)}묶음")
    for base, group in list(shared.items())[:5]:
        members = sorted(
            (row.get(_BID_NO_FIELD, ""), row.get("ETN_BID_ID", ""), row.get("ETN_BID_STT_NM", ""))
            for row in group
        )
        print(f"    {base}: {members}")


def rebid_command(args: argparse.Namespace) -> None:
    """목록만으로 재공고 차수를 알아볼 수 있는지 컬럼과 신호 교차표로 확인한다."""
    columns, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    print(f"창 {args.start_date}..{args.end_date} 반환={len(rows)} TOT_CNT={total_count(rows)}")
    print(f"응답 컬럼 {len(columns)}개: {columns}")
    print(f"{_BID_NO_FIELD} 존재: {_BID_NO_FIELD in columns}")
    marked = [row for row in rows if _has_rebid_suffix(row)]
    if _BID_NO_FIELD in columns:
        suffixes = Counter(row.get(_BID_NO_FIELD, "").rpartition("-")[2] for row in rows)
        print(f"  {_BID_NO_FIELD} 접미 분포: {dict(sorted(suffixes.items()))}")
        cross = Counter(
            (row.get(_BID_NO_FIELD, "").rpartition("-")[2], _has_rebid_suffix(row))
            for row in rows
        )
        print(f"  (번호 접미, BID_NM 재입찰 표시) 교차: {dict(sorted(cross.items()))}")
        print(f"  샘플 번호: {[row.get(_BID_NO_FIELD, '') for row in rows[:3]]}")
        _report_chains(rows)

    print(f"BID_NM {REBID_SUFFIX} 접미: {len(marked)}건 / {len(rows)}건")
    states = Counter(row.get("ETN_BID_STT_NM", "") for row in rows)
    marked_states = Counter(row.get("ETN_BID_STT_NM", "") for row in marked)
    print(f"  전체 상태: {dict(states)}")
    print(f"  접미 있는 행의 상태: {dict(marked_states)}")
    print(f"  상태 코드↔이름: {dict(Counter((row.get('ETN_BID_STT', ''), row.get('ETN_BID_STT_NM', '')) for row in rows))}")
    for row in marked[: args.samples]:
        print(
            f"  {row.get('ETN_BID_ID', ''):>9} BID_CNT={row.get('BID_CNT', ''):>4}"
            f" {row.get('ETN_BID_STT_NM', '')} {row.get('BID_NM', '')[:44]}"
        )


def page_size_command(args: argparse.Namespace) -> None:
    """검토된 상한 1000을 넘긴 요청의 status와 응답 형태를 관측한다."""
    for page_size in args.page_sizes:
        response = fetch_with_raw_page_size(
            start_date=args.start_date,
            end_date=args.end_date,
            page_size=page_size,
            region_code=args.region_code,
        )
        head = response.text[:120].replace("\n", " ")
        if response.status_code != 200:
            print(f"PAGE_SIZE={page_size:<7} HTTP {response.status_code} 본문앞={head!r}")
            continue
        try:
            _, rows = parse_rows(response.content)
        except SystemExit as error:
            print(f"PAGE_SIZE={page_size:<7} HTTP 200 파싱실패 {error} 본문앞={head!r}")
            continue
        print(
            f"PAGE_SIZE={page_size:<7} HTTP 200 반환={len(rows):<6}"
            f" TOT_CNT={total_count(rows):<8} bytes={len(response.content)}"
        )


def _calendar_date(value: str) -> date | None:
    """`YYYYMMDD` 앞 8자리만 달력 날짜로 읽는다. 여기서 재는 것은 시각차가 아니라 날짜 폭이다."""
    if len(value) != 8 or not value.isdigit():
        return None
    try:
        return date.fromisoformat(f"{value[:4]}-{value[4:6]}-{value[6:]}")
    except ValueError:
        return None


def _duration_days(row: Mapping[str, str]) -> int | None:
    start = _calendar_date(row.get("BID_STRT_DT", "")[:8])
    end = _calendar_date(row.get("BID_END_DT", "")[:8])
    if start is None or end is None:
        return None
    return (end - start).days


def _chunk_hits(durations: Sequence[int], chunk_days: int) -> float:
    """입찰기간이 `chunk_days` 창을 평균 몇 개 건드리는지 센다.

    창 필터가 겹침이므로 backfill을 `chunk_days` 단위로 쪼개면 기간이 chunk보다 긴 공고는 여러
    창에 다시 나타난다. 창 시작 위상이 균등하다고 보면 기대 창 수는 `1 + 기간/chunk`다.
    """
    return sum(1 + duration / chunk_days for duration in durations) / len(durations)


def chunking_command(args: argparse.Namespace) -> None:
    """입찰기간 길이 분포에서 backfill 분할 단위별 중복 계수를 계산한다."""
    _, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    durations = [value for value in map(_duration_days, rows) if value is not None]
    if not durations:
        raise SystemExit("입찰기간을 잰 행이 없다")
    ordered = sorted(durations)
    print(f"창 {args.start_date}..{args.end_date} 반환={len(rows)} TOT_CNT={total_count(rows)}")
    print(
        f"입찰기간(일) 표본={len(ordered)} 최소={ordered[0]} 중앙={ordered[len(ordered) // 2]}"
        f" 평균={sum(ordered) / len(ordered):.2f} p95={ordered[int(len(ordered) * 0.95)]}"
        f" 최대={ordered[-1]}"
    )
    print(f"  길이 분포: {dict(sorted(Counter(ordered).items()))}")
    # 몇 해에 걸친 장기계약 공고 소수가 평균을 지배한다. 중복 계수를 그 꼬리 유무로 나눠 보여야
    # 분할 단위 결정이 "전체 비용"과 "보통 공고 비용" 중 무엇을 근거로 했는지 남는다.
    typical = [value for value in ordered if value <= args.outlier_days]
    outliers = [value for value in ordered if value > args.outlier_days]
    print(f"  {args.outlier_days}일 초과 장기 공고: {len(outliers)}건 {outliers}")
    for chunk_days in args.chunks:
        print(
            f"  분할 {chunk_days:>3}일: 전체 {_chunk_hits(ordered, chunk_days):.2f}창"
            f" / 장기 제외 {_chunk_hits(typical, chunk_days):.2f}창"
        )


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    def add_window(command: argparse.ArgumentParser) -> None:
        command.add_argument("--start-date", required=True)
        command.add_argument("--end-date", required=True)
        command.add_argument("--page-size", type=int, default=1000)
        command.add_argument("--region-code", default="")

    rebid = subcommands.add_parser("rebid")
    add_window(rebid)
    rebid.add_argument("--samples", type=int, default=10)
    rebid.set_defaults(handler=rebid_command)

    page_size = subcommands.add_parser("page-size")
    page_size.add_argument("--start-date", required=True)
    page_size.add_argument("--end-date", required=True)
    page_size.add_argument("--region-code", default="")
    page_size.add_argument("--page-sizes", type=int, nargs="+", required=True)
    page_size.set_defaults(handler=page_size_command)

    chunking = subcommands.add_parser("chunking")
    add_window(chunking)
    chunking.add_argument("--chunks", type=int, nargs="+", default=[1, 7, 30])
    chunking.add_argument("--outlier-days", type=int, default=90)
    chunking.set_defaults(handler=chunking_command)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.handler(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
