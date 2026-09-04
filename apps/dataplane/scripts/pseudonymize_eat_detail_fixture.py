"""모듈 책임: 레이크의 Nexacro 상세 응답(raw XML) 하나를 읽어 지정한 dataset·column만 남기고
사업자·담당자 식별자와 구매기관(학교)명을 결정론적 가명으로 치환한 fixture를 재생성한다. 어떤
dataset과 `ds_info` column을 남길지는 호출자가 인자로 정하므로 이 스크립트 자체는 특정 fixture를
전제하지 않는다. `BID_NM`의 "[재입찰]" 접미사처럼 계약이 읽는 신호는 원본 그대로 보존해야 하므로,
문자열 전체를 정형 placeholder로 바꾸지 않고 그 신호를 먼저 판정한 뒤 기관명 부분만 치환한다.

재실행 방법(이 저장소가 실제로 커밋한 두 fixture를 그대로 재생성하는 예):

```
uv run --project apps/dataplane python apps/dataplane/scripts/pseudonymize_eat_detail_fixture.py \
  --source F:/Project/eat-bid/data/raw/internal/d3/5669410.xml.gz \
  --output apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml \
  --keep-datasets ds_info,ds_areaList,ds_bidList,ds_pList \
  --info-columns ELCTRN_BID_ID,ELCTRN_BID_NO,BID_NM,ELCTRN_BID_STT_NM,PURR_CD,PURR_NM,SIDO_CD,\
SIGUNGU_CD,PBANC_YMD,BID_END_DT,OPNG_DT,BGNG_PRC,ELCTRN_BID_PLNPRC,MAIN_ITEMS,PLNPRCE_SUCBD_STD,\
PLNPRC_TYPE_CD,PLNPRCE_TYPE_NM,SUCBD_DECISION_MTHD_NM,BID_CNT,UP_ELCTRN_BID_ID,RBID_YN \
  --bid-list-rows 0,1,2,3,4,5,82

uv run --project apps/dataplane python apps/dataplane/scripts/pseudonymize_eat_detail_fixture.py \
  --source F:/Project/eat-bid/data/raw/internal/00/5306521.xml.gz \
  --output apps/dataplane/tests/fixtures/eat/bid-detail-rebid.xml \
  --keep-datasets ds_info,ds_areaList,ds_bidList,ds_pList,ds_bidHistory \
  --info-columns ELCTRN_BID_ID,ELCTRN_BID_NO,BID_NM,ELCTRN_BID_STT_NM,PURR_CD,PURR_NM,SIDO_CD,\
SIGUNGU_CD,PBANC_YMD,BID_END_DT,OPNG_DT,BGNG_PRC,ELCTRN_BID_PLNPRC,MAIN_ITEMS,PLNPRCE_SUCBD_STD,\
PLNPRC_TYPE_CD,PLNPRCE_TYPE_NM,SUCBD_DECISION_MTHD_NM,BID_CNT,UP_ELCTRN_BID_ID,RBID_YN \
  --biz-no-offset 2000000000 --shipper-cd-offset 300000 --sgnng-id-offset 200000000
```

`--bid-list-rows`를 생략하면 `ds_bidList`의 모든 행을 남긴다(rebid fixture처럼 원본 행이 이미 적을
때). `--biz-no-offset`/`--shipper-cd-offset`/`--sgnng-id-offset`은 두 fixture의 가명 사업자번호가
겹치지 않도록 구분하는 값이다.
"""

from __future__ import annotations

import argparse
import gzip
from collections.abc import Callable, Sequence
from pathlib import Path
from xml.etree import ElementTree

NS = "http://www.nexacroplatform.com/platform/dataset"
ElementTree.register_namespace("", NS)
Q = f"{{{NS}}}"

BID_NM_PLACEHOLDER = "비식별 급식 식재료 구매"
BID_NM_REBID_PLACEHOLDER = f"{BID_NM_PLACEHOLDER} [재입찰]"
REBID_SUFFIX = "[재입찰]"


def resolve_bid_name(
    original: str | None,
    *,
    placeholder: str = BID_NM_PLACEHOLDER,
    placeholder_with_suffix: str = BID_NM_REBID_PLACEHOLDER,
) -> str:
    """`BID_NM`을 가명화하되 "[재입찰]" 접미사 유무는 원본 그대로 보존한다.

    `docs/evidence/source-boundary/2026-09-03-bid-roster-in-detail.md` §7이 확인한 대로, 재공고
    사슬의 최초 공고에는 이 접미사가 없고 재공고 차수에만 붙는다 — `ds_bidHistory`를 읽는 계약과
    T5 normalize 경로가 이 신호로 차수를 구분할 수 있어야 하므로 가명화가 이 신호를 지우면 안 된다.
    """
    has_suffix = (original or "").rstrip().endswith(REBID_SUFFIX)
    return placeholder_with_suffix if has_suffix else placeholder


def pseudonymize_business_id(index: int, offset: int) -> str:
    """사업자등록번호·사업자상호코드 형식(10자리 숫자)을 유지한 채 행 인덱스로 결정론적 가명을 만든다.

    같은 (index, offset) 조합은 항상 같은 값을 내고, offset을 fixture마다 다르게 주면 서로 다른
    fixture의 가명 사업자번호가 우연히도 겹치지 않는다.
    """
    return f"{offset + index * 7:010d}"


def _pseudonym_shipper_cd(offset: int) -> Callable[[int], str]:
    return lambda i: f"{offset + i:06d}"


def _pseudonym_sgnng_id(offset: int) -> Callable[[int], str]:
    return lambda i: f"{offset + i:09d}"


def _bid_list_pseudonym(
    *, biz_no_offset: int, shipper_cd_offset: int, sgnng_id_offset: int
) -> dict[str, Callable[[int], str]]:
    # 이 dict에 없는 column(RNK/SAJEONG_PCT/BID_CALC_AMT/WITHDRAWAL_YN 등 관측값, QLF_* 점수류)은
    # 손대지 않는다 — 개인·업체 식별자가 아니다.
    return {
        "BIZ_NO": lambda i: pseudonymize_business_id(i, biz_no_offset),
        "SHIPPER_BRNO": lambda i: pseudonymize_business_id(i, biz_no_offset),
        "SHIPPER_CD": _pseudonym_shipper_cd(shipper_cd_offset),
        "SHIPPER_NM": lambda i: f"비식별 업체 {i + 1}",
        "FRST_RGTR_ID": lambda i: f"user{i:04d}",
        "LAST_CHGR_ID": lambda _i: "S000000000",
        "SGNNG_ID": _pseudonym_sgnng_id(sgnng_id_offset),
        "BID_NO": lambda i: f"B000000-{i:06d}",
        "NARA_BIZ_NO": lambda _i: "부정당업자가 아닙니다.",
    }


def _load(path: Path) -> ElementTree.Element:
    return ElementTree.fromstring(gzip.open(path, "rb").read())


def _dataset(root: ElementTree.Element, name: str) -> ElementTree.Element | None:
    return next((d for d in root.iter(Q + "Dataset") if d.get("id") == name), None)


def _rows(node: ElementTree.Element) -> list[ElementTree.Element]:
    return node.findall(f"{Q}Rows/{Q}Row")


def _drop_unused_datasets(root: ElementTree.Element, keep_datasets: Sequence[str]) -> None:
    keep_ids = set(keep_datasets)
    for node in list(root):
        # ErrorCode 같은 Parameters 블록은 계약이 읽지 않는다 — Dataset 외 형제도 모두 뺀다.
        if node.tag != Q + "Dataset" or node.get("id") not in keep_ids:
            root.remove(node)


def _trim_bid_list_rows(root: ElementTree.Element, keep_indexes: Sequence[int]) -> None:
    bid_list = _dataset(root, "ds_bidList")
    if bid_list is None:
        return
    container = bid_list.find(Q + "Rows")
    assert container is not None, "ds_bidList에 Rows가 없다"
    all_rows = _rows(bid_list)
    kept = [all_rows[i] for i in keep_indexes]
    for row in all_rows:
        container.remove(row)
    for row in kept:
        container.append(row)


def _trim_info_columns(root: ElementTree.Element, info_columns: Sequence[str]) -> None:
    node = _dataset(root, "ds_info")
    if node is None:
        return
    keep = set(info_columns)
    column_info = node.find(Q + "ColumnInfo")
    assert column_info is not None, "ds_info에 ColumnInfo가 없다"
    for column in list(column_info):
        if column.get("id") not in keep:
            column_info.remove(column)
    row = _rows(node)[0]
    for col in list(row):
        if col.get("id") not in keep:
            row.remove(col)


def _pseudonymize_bid_list(root: ElementTree.Element, pseudonym: dict[str, Callable[[int], str]]) -> None:
    node = _dataset(root, "ds_bidList")
    if node is None:
        return
    for index, row in enumerate(_rows(node)):
        for col in row.findall(Q + "Col"):
            col_id = col.get("id")
            builder = pseudonym.get(col_id) if col_id is not None else None
            if builder is not None:
                col.text = builder(index)


def _pseudonymize_info(root: ElementTree.Element) -> None:
    node = _dataset(root, "ds_info")
    if node is None:
        return
    row = _rows(node)[0]
    for col in row.findall(Q + "Col"):
        col_id = col.get("id")
        if col_id == "PURR_NM":
            col.text = "비식별 구매기관"
        elif col_id == "BID_NM":
            col.text = resolve_bid_name(col.text)


def _pseudonymize_bid_history(root: ElementTree.Element) -> None:
    node = _dataset(root, "ds_bidHistory")
    if node is None:
        return
    for row in _rows(node):
        for col in row.findall(Q + "Col"):
            col_id = col.get("id")
            if col_id == "BID_NM":
                col.text = resolve_bid_name(col.text)
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


def build_fixture(
    *,
    source: Path,
    output: Path,
    keep_datasets: Sequence[str],
    info_columns: Sequence[str],
    bid_list_rows: Sequence[int] | None,
    biz_no_offset: int,
    shipper_cd_offset: int,
    sgnng_id_offset: int,
) -> None:
    root = _load(source)
    _drop_unused_datasets(root, keep_datasets)
    if bid_list_rows is not None:
        _trim_bid_list_rows(root, bid_list_rows)
    _trim_info_columns(root, info_columns)
    _pseudonymize_bid_list(
        root,
        _bid_list_pseudonym(
            biz_no_offset=biz_no_offset,
            shipper_cd_offset=shipper_cd_offset,
            sgnng_id_offset=sgnng_id_offset,
        ),
    )
    _pseudonymize_info(root)
    _pseudonymize_bid_history(root)
    _write(root, output)


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def _csv_int(value: str) -> list[int]:
    return [int(item) for item in _csv(value)]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--source", type=Path, required=True, help="레이크 원본 .xml.gz 경로")
    parser.add_argument("--output", type=Path, required=True, help="가명화한 fixture를 쓸 경로")
    parser.add_argument(
        "--keep-datasets",
        type=_csv,
        required=True,
        help="남길 dataset id를 쉼표로 구분해 나열한다(예: ds_info,ds_areaList,ds_bidList)",
    )
    parser.add_argument(
        "--info-columns",
        type=_csv,
        required=True,
        help="ds_info에서 남길 column id를 쉼표로 구분해 나열한다",
    )
    parser.add_argument(
        "--bid-list-rows",
        type=_csv_int,
        default=None,
        help="ds_bidList에서 남길 행 인덱스(0부터)를 쉼표로 구분해 나열한다. 생략하면 전부 남긴다",
    )
    parser.add_argument("--biz-no-offset", type=int, default=1_000_000_000)
    parser.add_argument("--shipper-cd-offset", type=int, default=200_000)
    parser.add_argument("--sgnng-id-offset", type=int, default=100_000_000)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    build_fixture(
        source=args.source,
        output=args.output,
        keep_datasets=args.keep_datasets,
        info_columns=args.info_columns,
        bid_list_rows=args.bid_list_rows,
        biz_no_offset=args.biz_no_offset,
        shipper_cd_offset=args.shipper_cd_offset,
        sgnng_id_offset=args.sgnng_id_offset,
    )
    print(f"{args.output} 재생성 완료")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
