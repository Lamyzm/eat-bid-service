"""레이크 리포트 테스트가 함께 쓰는 최소 원본 만들기.

관측은 gzip으로 눌린 Nexacro 응답 파일 하나를 단위로 하므로, 레이크 없이 그 모양을 그대로 만든다.
"""

from __future__ import annotations

import gzip
from collections.abc import Mapping, Sequence
from pathlib import Path

NS = "http://www.nexacroplatform.com/platform/dataset"

DEFAULT_INFO: Mapping[str, str] = {
    "BID_NM": "비식별 급식 식재료 구매",
    "ELCTRN_BID_STT_NM": "낙찰",
    "PURR_CD": "153045",
    "PURR_NM": "비식별 구매기관",
    "OPNG_DT": "20251120022000",
    "PLNPRCE_SUCBD_STD": "90",
}


def row(columns: Mapping[str, str]) -> str:
    body = "".join(f'<Col id="{key}">{value}</Col>' for key, value in columns.items())
    return f"<Row>{body}</Row>"


def dataset(name: str, rows: Sequence[Mapping[str, str]]) -> str:
    body = "".join(row(item) for item in rows)
    return f'<Dataset id="{name}"><Rows>{body}</Rows></Dataset>'


def detail_document(
    *,
    info: Mapping[str, str] | None = None,
    bid_list: Sequence[Mapping[str, str]] = (),
    p_list: Sequence[Mapping[str, str]] = (),
) -> bytes:
    """관측이 읽는 최소 상세 응답. 계약이 요구하는 `ds_info` 넷은 기본값으로 채운다."""
    datasets = [dataset("ds_info", [{**DEFAULT_INFO, **(info or {})}])]
    if bid_list:
        datasets.append(dataset("ds_bidList", bid_list))
    if p_list:
        datasets.append(dataset("ds_pList", p_list))
    return f'<Root xmlns="{NS}">{"".join(datasets)}</Root>'.encode()


def write_lake_file(lake: Path, external_bid_id: str, payload: bytes) -> Path:
    """레이크와 같은 `<shard>/<공고 id>.xml.gz` 배치로 쓴다."""
    shard = lake / external_bid_id[:2]
    shard.mkdir(parents=True, exist_ok=True)
    path = shard / f"{external_bid_id}.xml.gz"
    path.write_bytes(gzip.compress(payload))
    return path


def submission(
    *,
    bid_rate: str,
    amount: str = "6101000",
    status: str = "005",
    shipper: str = "1",
    **extra: str,
) -> dict[str, str]:
    return {
        "SAJEONG_PCT": bid_rate,
        "BID_CALC_AMT": amount,
        "BID_STT": status,
        "SHIPPER_CD": shipper,
        **extra,
    }
