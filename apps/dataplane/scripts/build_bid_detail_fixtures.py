"""모듈 책임: 레이크의 Nexacro 상세 응답(raw XML)에서 입찰 명단·예비가격·재입찰 이력 fixture를
가명화해 재생성한다. 사업자·담당자 식별자와 구매기관(학교)명만 결정론적 가명으로 바꾸고, dataset·
column 구조와 값의 형식(자릿수·구분자)은 그대로 둔다. `ds_bidHistory.BID_NM`의 "[재입찰]" 접미사
유무처럼 계약이 읽는 신호는 행별 원본 그대로 보존해야 하므로, 문자열 전체를 정형 placeholder로
바꾸지 않고 그 신호를 먼저 판정한 뒤 기관명 부분만 치환한다.

재실행 방법: `uv run --project apps/dataplane python apps/dataplane/scripts/build_bid_detail_fixtures.py
roster --source F:/Project/eat-bid/data/raw/internal/d3/5669410.xml.gz --output
apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml`처럼 `roster`/`rebid` 하위 명령에 레이크
원본 경로와 출력 경로를 인자로 준다. 기본값은 이 저장소가 실제로 쓴 원본·출력 경로다.
"""

from __future__ import annotations

import argparse
import gzip
from collections.abc import Callable, Iterable
from pathlib import Path
from xml.etree import ElementTree

NS = "http://www.nexacroplatform.com/platform/dataset"
ElementTree.register_namespace("", NS)
Q = f"{{{NS}}}"

# ds_info에서 fixture에 남길 21개 column. 나머지 95개는 계약이 읽지 않아 fixture가 무엇을
# 고정하는지 흐리므로 뺀다. roster·rebid 두 fixture가 공유한다.
INFO_KEEP_COLUMNS = (
    "ELCTRN_BID_ID", "ELCTRN_BID_NO", "BID_NM", "ELCTRN_BID_STT_NM", "PURR_CD",
    "PURR_NM", "SIDO_CD", "SIGUNGU_CD", "PBANC_YMD", "BID_END_DT", "OPNG_DT",
    "BGNG_PRC", "ELCTRN_BID_PLNPRC", "MAIN_ITEMS", "PLNPRCE_SUCBD_STD",
    "PLNPRC_TYPE_CD", "PLNPRCE_TYPE_NM", "SUCBD_DECISION_MTHD_NM", "BID_CNT",
    "UP_ELCTRN_BID_ID", "RBID_YN",
)

BID_NM_PLACEHOLDER = "비식별 급식 식재료 구매"
BID_NM_REBID_PLACEHOLDER = f"{BID_NM_PLACEHOLDER} [재입찰]"

ROSTER_SOURCE_DEFAULT = "F:/Project/eat-bid/data/raw/internal/d3/5669410.xml.gz"
ROSTER_OUTPUT_DEFAULT = "apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml"
# RNK 1~6(순위 표시 확인) + WITHDRAWAL_YN=Y 1행(철회 확인). 하한 미만(SAJEONG_PCT<90) 행은 이
# 공고에 없다(최저가 90.218, 85행 전수 확인) — 그 케이스는 bid-detail-rebid.xml의 실측 행
# (SAJEONG_PCT=89.626, WITHDRAWAL_YN=Y)이 이미 담당한다.
ROSTER_BID_LIST_KEEP_INDEXES = (0, 1, 2, 3, 4, 5, 82)

REBID_SOURCE_DEFAULT = "F:/Project/eat-bid/data/raw/internal/00/5306521.xml.gz"
REBID_OUTPUT_DEFAULT = "apps/dataplane/tests/fixtures/eat/bid-detail-rebid.xml"


def _pseudonym_biz_no(offset: int) -> Callable[[int], str]:
    return lambda i: f"{offset + i * 7:010d}"


def _pseudonym_shipper_cd(offset: int) -> Callable[[int], str]:
    return lambda i: f"{offset + i:06d}"


def _pseudonym_sgnng_id(offset: int) -> Callable[[int], str]:
    return lambda i: f"{offset + i:09d}"


def _bid_list_pseudonym(*, biz_no_offset: int, shipper_cd_offset: int, sgnng_id_offset: int):
    # 관측값 그대로 두는 column(RNK/SAJEONG_PCT/BID_CALC_AMT/WITHDRAWAL_YN 등)과 QLF_* 점수류처럼
    # 이 dict에 없는 column은 손대지 않는다 — 개인·업체 식별자가 아니다.
    return {
        "BIZ_NO": _pseudonym_biz_no(biz_no_offset),
        "SHIPPER_BRNO": _pseudonym_biz_no(biz_no_offset),
        "SHIPPER_CD": _pseudonym_shipper_cd(shipper_cd_offset),
        "SHIPPER_NM": lambda i: f"비식별 업체 {i + 1}",
        "FRST_RGTR_ID": lambda i: f"user{i:04d}",
        "LAST_CHGR_ID": lambda i: "S000000000",
        "SGNNG_ID": _pseudonym_sgnng_id(sgnng_id_offset),
        "BID_NO": lambda i: f"B000000-{i:06d}",
        "NARA_BIZ_NO": lambda i: "부정당업자가 아닙니다.",
    }


def _load(path: Path) -> ElementTree.Element:
    return ElementTree.fromstring(gzip.open(path, "rb").read())


def _dataset(root: ElementTree.Element, name: str) -> ElementTree.Element:
    return next(d for d in root.iter(Q + "Dataset") if d.get("id") == name)


def _rows(node: ElementTree.Element) -> list[ElementTree.Element]:
    return node.findall(f"{Q}Rows/{Q}Row")


def _drop_unused_datasets(root: ElementTree.Element, keep: Iterable[str]) -> None:
    keep_ids = set(keep)
    for node in list(root):
        # ErrorCode 같은 Parameters 블록은 계약이 읽지 않는다 — Dataset 외 형제도 모두 뺀다.
        if node.tag != Q + "Dataset" or node.get("id") not in keep_ids:
            root.remove(node)


def _trim_info_columns(root: ElementTree.Element) -> None:
    node = _dataset(root, "ds_info")
    column_info = node.find(Q + "ColumnInfo")
    assert column_info is not None, "ds_info에 ColumnInfo가 없다"
    for column in list(column_info):
        if column.get("id") not in INFO_KEEP_COLUMNS:
            column_info.remove(column)
    row = _rows(node)[0]
    for col in list(row):
        if col.get("id") not in INFO_KEEP_COLUMNS:
            row.remove(col)


def _pseudonymize_bid_list(root: ElementTree.Element, pseudonym: dict[str, Callable[[int], str]]) -> None:
    node = _dataset(root, "ds_bidList")
    for index, row in enumerate(_rows(node)):
        for col in row.findall(Q + "Col"):
            col_id = col.get("id")
            builder = pseudonym.get(col_id) if col_id is not None else None
            if builder is not None:
                col.text = builder(index)


def _pseudonymize_info(root: ElementTree.Element) -> None:
    row = _rows(_dataset(root, "ds_info"))[0]
    for col in row.findall(Q + "Col"):
        col_id = col.get("id")
        if col_id == "PURR_NM":
            col.text = "비식별 구매기관"
        elif col_id == "BID_NM":
            has_rebid_suffix = (col.text or "").rstrip().endswith("[재입찰]")
            col.text = BID_NM_REBID_PLACEHOLDER if has_rebid_suffix else BID_NM_PLACEHOLDER


def _pseudonymize_bid_history(root: ElementTree.Element) -> None:
    # 원본 BID_NM은 재공고 사슬의 최초 공고에는 "[재입찰]" 접미사가 없고 이후 차수에만 붙는다.
    # docs/evidence/source-boundary/2026-09-03-bid-roster-in-detail.md §7이 이 유무 차이를 재공고
    # 사슬을 읽는 신호로 확인했으므로, 가명화가 기관명만 바꾸고 접미사 유무는 행별 원본 그대로
    # 보존해야 한다.
    node = _dataset(root, "ds_bidHistory")
    if node is None:
        return
    for row in _rows(node):
        for col in row.findall(Q + "Col"):
            col_id = col.get("id")
            if col_id == "BID_NM":
                has_rebid_suffix = (col.text or "").rstrip().endswith("[재입찰]")
                col.text = BID_NM_REBID_PLACEHOLDER if has_rebid_suffix else BID_NM_PLACEHOLDER
            elif col_id in {"FRST_RGTR_ID", "LAST_CHGR_ID"}:
                col.text = "S000000000"


def _write(root: ElementTree.Element, output: Path) -> None:
    ElementTree.indent(root, space="  ")
    tree = ElementTree.ElementTree(root)
    output.parent.mkdir(parents=True, exist_ok=True)
    tree.write(output, encoding="utf-8", xml_declaration=True)
    # ElementTree가 쓰는 XML 선언은 소문자 작은따옴표(`<?xml version='1.0' ...?>`)라 기존 fixture
    # 관례(큰따옴표, UTF-8 대문자)와 다르다 — 파싱 결과는 같지만 diff 잡음을 없애려 다시 쓴다.
    text = output.read_text(encoding="utf-8")
    text = text.replace(
        "<?xml version='1.0' encoding='utf-8'?>",
        '<?xml version="1.0" encoding="UTF-8"?>',
        1,
    )
    output.write_text(text, encoding="utf-8", newline="\n")


def build_roster(source: Path, output: Path) -> None:
    """RNK 1~6과 철회 1행만 남긴 명단 fixture를 만든다."""
    root = _load(source)
    _drop_unused_datasets(root, {"ds_info", "ds_areaList", "ds_bidList", "ds_pList"})
    bid_list = _dataset(root, "ds_bidList")
    container = bid_list.find(Q + "Rows")
    assert container is not None, "ds_bidList에 Rows가 없다"
    all_rows = _rows(bid_list)
    kept = [all_rows[i] for i in ROSTER_BID_LIST_KEEP_INDEXES]
    for row in all_rows:
        container.remove(row)
    for row in kept:
        container.append(row)
    _trim_info_columns(root)
    _pseudonymize_bid_list(
        root,
        _bid_list_pseudonym(biz_no_offset=1_000_000_000, shipper_cd_offset=200_000, sgnng_id_offset=100_000_000),
    )
    _pseudonymize_info(root)
    _write(root, output)


def build_rebid(source: Path, output: Path) -> None:
    """ds_bidHistory 전체와 ds_bidList 전체(하한 미만 실측 행 포함)를 남긴 재입찰 fixture를 만든다."""
    root = _load(source)
    _drop_unused_datasets(
        root, {"ds_info", "ds_areaList", "ds_bidList", "ds_pList", "ds_bidHistory"}
    )
    _trim_info_columns(root)
    _pseudonymize_bid_list(
        root,
        _bid_list_pseudonym(biz_no_offset=2_000_000_000, shipper_cd_offset=300_000, sgnng_id_offset=200_000_000),
    )
    _pseudonymize_info(root)
    _pseudonymize_bid_history(root)
    _write(root, output)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    roster = subcommands.add_parser("roster", help="bid-detail-roster.xml을 재생성한다")
    roster.add_argument("--source", type=Path, default=Path(ROSTER_SOURCE_DEFAULT))
    roster.add_argument("--output", type=Path, default=Path(ROSTER_OUTPUT_DEFAULT))
    roster.set_defaults(handler=lambda args: build_roster(args.source, args.output))

    rebid = subcommands.add_parser("rebid", help="bid-detail-rebid.xml을 재생성한다")
    rebid.add_argument("--source", type=Path, default=Path(REBID_SOURCE_DEFAULT))
    rebid.add_argument("--output", type=Path, default=Path(REBID_OUTPUT_DEFAULT))
    rebid.set_defaults(handler=lambda args: build_rebid(args.source, args.output))

    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    args.handler(args)
    print(f"{args.command}: {args.output} 재생성 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
