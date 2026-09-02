# -*- coding: utf-8 -*-
"""모듈 책임: 전수 233,382 개 원본에서 예비가격 판을 한 번만 긁어 행렬로 굳힌다.

왜 캐시하나: 04·05 가 각각 전수를 다시 긁었다. 앞으로 f_R 시뮬레이션·층화 분해·
경쟁자 투표 재구성이 전부 같은 판을 필요로 한다. 매번 gz 233k 개를 다시 여는 건
낭비이고, 무엇보다 **판이 매번 미세하게 달라질 여지**를 남긴다(필터 조건을 스크립트마다
다시 적으므로). 한 번 굳혀서 모두가 같은 판을 본다.

출력: data/mechanism/plist.npz
    rate    float64 [n,15]   슬롯 1..15 의 예비가격 비율 (CMNM_PLNPRC_RT)
    chosen  bool    [n,15]   CHC_YN == 'Y'
    bid_cnt int32   [n]      ds_info.BID_CNT (-1 = 없음)
    year    int16   [n]      ds_info.REGYYYY
    floor   int16   [n]      ds_info.PLNPRCE_SUCBD_STD (하한율, -1 = 없음)
    bgng    float64 [n]      기초가격
    plnprc  float64 [n]      예정가격
    bid_id  U16     [n]      ELCTRN_BID_ID

포함 조건(이 한 곳에만 적는다): ds_pList 15행 · 슬롯번호 1..15 전부 · CHC_YN='Y' 정확히 4개.
"""
from __future__ import annotations

import glob
import gzip
import os
import re
import sys
from multiprocessing import Pool

import numpy as np

ROOT = os.environ.get("EATBID_RAW", r"F:/Project/eat-bid/data/raw/internal")
OUT = os.environ.get("EATBID_MECH_OUT", r"F:/Project/eat-bid/data/mechanism/plist.npz")

DS = re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>', re.S)
ROW = re.compile(r"<Row>(.*?)</Row>", re.S)
COL = re.compile(r'<Col id="([^"]+)">(.*?)</Col>', re.S)


def _i(v, d=-1):
    try:
        return int(float(v))
    except Exception:
        return d


def _f(v, d=float("nan")):
    try:
        return float(v)
    except Exception:
        return d


def work(paths):
    rates, chosen, bidcnt, year, floor, bgng, plnprc, bids = [], [], [], [], [], [], [], []
    skip = 0
    for p in paths:
        try:
            s = gzip.open(p, "rt", encoding="utf-8", errors="replace").read()
        except Exception:
            skip += 1
            continue
        blocks = dict(DS.findall(s))
        pbody = blocks.get("ds_pList")
        if not pbody:
            skip += 1
            continue
        rows = [dict(COL.findall(r)) for r in ROW.findall(pbody)]
        if len(rows) != 15:
            skip += 1
            continue
        try:
            byseq = {int(float(r["CMNM_PLNPRC_SN"])): (
                float(r["CMNM_PLNPRC_RT"]), (r.get("CHC_YN") or "").strip() == "Y")
                for r in rows}
        except Exception:
            skip += 1
            continue
        if set(byseq) != set(range(1, 16)):
            skip += 1
            continue
        ch = [byseq[k][1] for k in range(1, 16)]
        if sum(ch) != 4:
            skip += 1
            continue
        rates.append([byseq[k][0] for k in range(1, 16)])
        chosen.append(ch)

        info = {}
        ibody = blocks.get("ds_info")
        if ibody:
            m = ROW.search(ibody)
            if m:
                info = dict(COL.findall(m.group(1)))
        bidcnt.append(_i(info.get("BID_CNT")))
        year.append(_i(info.get("REGYYYY")))
        floor.append(_i(info.get("PLNPRCE_SUCBD_STD")))
        bgng.append(_f(info.get("BGNG_PRC")))
        plnprc.append(_f(info.get("ELCTRN_BID_PLNPRC")))
        bids.append((info.get("ELCTRN_BID_ID") or "")[:16])
    return (np.array(rates, dtype=np.float64).reshape(-1, 15),
            np.array(chosen, dtype=bool).reshape(-1, 15),
            np.array(bidcnt, dtype=np.int32), np.array(year, dtype=np.int16),
            np.array(floor, dtype=np.int16), np.array(bgng, dtype=np.float64),
            np.array(plnprc, dtype=np.float64), np.array(bids, dtype="U16"), skip)


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    files = []
    for d in sorted(os.listdir(ROOT)):
        files += glob.glob(os.path.join(ROOT, d, "*.xml.gz"))
    files.sort()
    if limit and limit < len(files):
        files = files[:: len(files) // limit][:limit]
    print("파일 %d 개" % len(files), flush=True)
    chunks = [c for c in (files[i::48] for i in range(48)) if c]
    parts = []
    skip = 0
    with Pool(12) as pool:
        for r in pool.imap_unordered(work, chunks):
            parts.append(r[:8])
            skip += r[8]
    cat = [np.concatenate([p[i] for p in parts]) for i in range(8)]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    np.savez_compressed(OUT, rate=cat[0], chosen=cat[1], bid_cnt=cat[2],
                        year=cat[3], floor=cat[4], bgng=cat[5], plnprc=cat[6],
                        bid_id=cat[7])
    print("회차 %d 저장 · 제외 %d · %s (%.1f MB)" % (
        cat[0].shape[0], skip, OUT, os.path.getsize(OUT) / 1e6))


if __name__ == "__main__":
    main()
