"""모듈 책임: eaT list endpoint의 실제 응답을 읽기 전용으로 관측해 수집 모드 설계 근거를 남긴다.

왜 필요한가. WorkflowTemplate의 날짜 창, 페이지 크기, 상세 재호출 조건은 소스가 실제로 무엇을
돌려주는지에 달려 있다. 이 스크립트는 아무것도 저장하지 않고 그 사실만 보고한다. 수집 경로가
아니므로 R2와 PostgreSQL을 건드리지 않으며 원본 보존은 `eatbid capture`의 책임으로 남는다.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from eat_probe import fetch_page, total_count

from eatbid.source.eat.registry import require

TRACKED_COLUMNS = ("BID_CNT", "LAST_CHG_DT", "ETN_BID_STT_NM", "BID_END_DT", "BID_NM")
OPEN_STATES = frozenset({"입찰공고", "진행중"})


def columns_command(args: argparse.Namespace) -> None:
    """응답 컬럼과 검토된 파서 계약의 차이를 보고한다."""
    contract = require("bid-list", parser_version="eat-v1")
    columns, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    print(f"응답 컬럼 {len(columns)}개, 행 {len(rows)}개, TOT_CNT={total_count(rows)}")
    for dataset, known in contract.datasets.items():
        unknown = [column for column in columns if column not in known]
        print(f"  계약 {dataset}: {list(known)}")
        print(f"  계약 밖 컬럼 {len(unknown)}개: {unknown}")


def pagination_command(args: argparse.Namespace) -> None:
    """요청한 PAGE_SIZE와 실제 반환 행 수, RN 연속성을 대조한다."""
    for page_size in args.page_sizes:
        columns, rows = fetch_page(
            start_date=args.start_date,
            end_date=args.end_date,
            page_size=page_size,
            page=args.page,
            region_code=args.region_code,
        )
        del columns
        row_numbers = [int(row["RN"]) for row in rows if row.get("RN", "").isdigit()]
        expected = list(
            range((args.page - 1) * page_size + 1, (args.page - 1) * page_size + len(rows) + 1)
        )
        print(
            f"PAGE_SIZE={page_size:<5} page={args.page} 반환={len(rows):<5}"
            f" TOT_CNT={total_count(rows):<8} RN연속={row_numbers == expected}"
        )


def window_command(args: argparse.Namespace) -> None:
    """여러 날짜 창을 순서대로 조회해 과거 구간 수용 여부와 규모를 보고한다."""
    for window in args.windows:
        start_date, _, end_date = window.partition("..")
        if not end_date:
            raise SystemExit(f"창 형식은 YYYYMMDD..YYYYMMDD 이다: {window}")
        _, rows = fetch_page(
            start_date=start_date,
            end_date=end_date,
            page_size=args.page_size,
            page=1,
            region_code=args.region_code,
        )
        states = Counter(row.get("ETN_BID_STT_NM", "") for row in rows)
        print(f"{window}  TOT_CNT={total_count(rows):<8} 반환={len(rows):<5} 상태={dict(states)}")


def dates_command(args: argparse.Namespace) -> None:
    """반환 행의 날짜 컬럼 범위를 보여 창 파라미터가 어느 필드를 거는지 식별한다."""
    _, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    print(f"창 {args.start_date}..{args.end_date} 반환={len(rows)} TOT_CNT={total_count(rows)}")
    date_columns = [
        column
        for column in ("PBANC_YMD", "BID_STRT_DT", "BID_END_DT", "LAST_CHG_DT", "DLVRY_STRT_DT", "DLVRY_END_DT")
        if any(row.get(column) for row in rows)
    ]
    for column in date_columns:
        values = sorted(row[column][:8] for row in rows if row.get(column))
        inside = sum(1 for value in values if args.start_date <= value <= args.end_date)
        print(
            f"  {column:<14} min={values[0]} max={values[-1]}"
            f" 창안={inside}/{len(values)}"
        )
    states = Counter(row.get("ETN_BID_STT_NM", "") for row in rows)
    print(f"  상태 분포: {dict(states)}")


def settle_command(args: argparse.Namespace) -> None:
    """마감 뒤 며칠까지 값이 바뀌는지 재서 daily-reconcile 창의 근거를 만든다."""
    _, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    lag = Counter()
    states = Counter()
    for row in rows:
        end_date, changed = row.get("BID_END_DT", "")[:8], row.get("LAST_CHG_DT", "")[:8]
        if len(end_date) != 8 or len(changed) != 8:
            continue
        end_day = datetime.strptime(end_date, "%Y%m%d").replace(tzinfo=UTC)
        changed_day = datetime.strptime(changed, "%Y%m%d").replace(tzinfo=UTC)
        lag[(changed_day - end_day).days] += 1
        states[row.get("ETN_BID_STT_NM", "")] += 1
    total = sum(lag.values())
    print(f"창 {args.start_date}..{args.end_date} 반환={len(rows)} 측정={total}")
    print(f"  상태: {dict(states)}")
    cumulative = 0
    for days in sorted(lag):
        cumulative += lag[days]
        share = cumulative / total * 100 if total else 0
        print(f"  마감 대비 {days:+3d}일: {lag[days]:4d}건  누적 {share:5.1f}%")


def snapshot_command(args: argparse.Namespace) -> None:
    """열린 공고의 추적 컬럼을 저장하고 이전 스냅샷과 대조한다."""
    observed_at = datetime.now(UTC).isoformat()
    _, rows = fetch_page(
        start_date=args.start_date,
        end_date=args.end_date,
        page_size=args.page_size,
        page=1,
        region_code=args.region_code,
    )
    current = {
        row["ETN_BID_ID"]: {column: row.get(column, "") for column in TRACKED_COLUMNS}
        for row in rows
        if row.get("ETN_BID_ID")
    }
    print(f"{observed_at} 관측 {len(current)}건")

    path = Path(args.snapshot)
    if path.exists():
        previous = json.loads(path.read_text(encoding="utf-8"))
        print(f"  이전 관측 {previous['observed_at']}")
        changed = 0
        for bid_id, values in current.items():
            before = previous["rows"].get(bid_id)
            if before is None:
                print(f"  신규 {bid_id} BID_CNT={values['BID_CNT']}")
                changed += 1
                continue
            deltas = {
                column: (before.get(column, ""), values[column])
                for column in TRACKED_COLUMNS
                if before.get(column, "") != values[column]
            }
            if deltas:
                print(f"  변경 {bid_id} {values['BID_NM'][:30]}")
                for column, (old, new) in deltas.items():
                    print(f"    {column}: {old!r} -> {new!r}")
                changed += 1
        print(f"  변경 {changed}건 / 전체 {len(current)}건")
    else:
        print("  이전 스냅샷이 없어 기준으로 저장한다")

    path.write_text(
        json.dumps({"observed_at": observed_at, "rows": current}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    open_rows = [
        values for values in current.values() if values["ETN_BID_STT_NM"] in OPEN_STATES
    ]
    counts = sorted(
        int(values["BID_CNT"]) for values in open_rows if values["BID_CNT"].isdigit()
    )
    print(f"  열린 공고 {len(open_rows)}건 BID_CNT={counts}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    def add_window(command: argparse.ArgumentParser) -> None:
        command.add_argument("--start-date", required=True)
        command.add_argument("--end-date", required=True)
        command.add_argument("--page-size", type=int, default=100)
        command.add_argument("--region-code", default="")

    columns = subcommands.add_parser("columns")
    add_window(columns)
    columns.set_defaults(handler=columns_command)

    pagination = subcommands.add_parser("pagination")
    add_window(pagination)
    pagination.add_argument("--page", type=int, default=1)
    pagination.add_argument("--page-sizes", type=int, nargs="+", required=True)
    pagination.set_defaults(handler=pagination_command)

    dates = subcommands.add_parser("dates")
    add_window(dates)
    dates.set_defaults(handler=dates_command)

    settle = subcommands.add_parser("settle")
    add_window(settle)
    settle.set_defaults(handler=settle_command)

    window = subcommands.add_parser("window")
    window.add_argument("--windows", nargs="+", required=True)
    window.add_argument("--page-size", type=int, default=1)
    window.add_argument("--region-code", default="")
    window.set_defaults(handler=window_command)

    snapshot = subcommands.add_parser("snapshot")
    add_window(snapshot)
    snapshot.add_argument("--snapshot", required=True)
    snapshot.set_defaults(handler=snapshot_command)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.handler(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
