# -*- coding: utf-8 -*-
"""모듈 책임: ds_bidList 를 긁어 회차별 투찰 요약과 실제 투표(DRAW_NO)를 굳힌다.

목적 둘.

(1) 🔴 **007 전수라는 선택 편향을 가른다.**
    회차는 max_j x_j >= R 일 때만 낙찰된다 (x = 투찰금액/(기초가*하한율/100)).
    우리 코퍼스는 007 뿐이므로, R 이 낮게 나온 회차가 살아남기 쉽다.
    이건 회차 안에서 보고 있어도 콜라이더로 들어와 mean(D)<0 을 만든다.

    **가르는 칼**: max_j x_j >= max(후보 15개) 인 회차는 **어떤 4개가 뽑혔어도
    낙찰됐다.** 그 부분집합에는 선택 편향이 원리적으로 없다.
    거기서 D 의 초과분이 사라지면 07 의 결론은 선택 편향이고,
    남으면 진짜 의존이다.

(2) DRAW_NO 로 투표를 직접 세어 CHC_YN 이 정말 최다득표 4개인지 확인한다.

출력: data/mechanism/bids.npz  (plist.npz 와 bid_id 로 조인)
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
OUT = os.environ.get("EATBID_BIDS_OUT", r"F:/Project/eat-bid/data/mechanism/bids.npz")

DS = re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>', re.S)
ROW = re.compile(r"<Row>(.*?)</Row>", re.S)
COL = re.compile(r'<Col id="([^"]+)">(.*?)</Col>', re.S)
NUM = re.compile(r"\d+")


def work(paths):
    bid_id, amax, amin, nbid, nwd, votes, nvote, floor, bgng = [], [], [], [], [], [], [], [], []
    pmax, pmin = [], []
    votes_all, nvote_all = [], []
    amax_nw, pmax_nw = [], []
    for p in paths:
        try:
            s = gzip.open(p, "rt", encoding="utf-8", errors="replace").read()
        except Exception:
            continue
        blocks = dict(DS.findall(s))
        ib, bb = blocks.get("ds_info"), blocks.get("ds_bidList")
        if not ib or not bb:
            continue
        mrow = ROW.search(ib)
        info = dict(COL.findall(mrow.group(1))) if mrow else {}
        bid = (info.get("ELCTRN_BID_ID") or "")[:16]
        if not bid:
            continue
        try:
            bg = float(info["BGNG_PRC"])
            fl = float(info["PLNPRCE_SUCBD_STD"])
        except Exception:
            continue
        if not (bg > 0 and fl > 0):
            continue
        base = bg * fl / 100.0

        # 🔴 BID_CALC_AMT 를 쓰면 안 된다. 실측(2026-09-02): 일부 행이
        #    10000000115368 처럼 10^13 접두가 붙은 오염값이다. 같은 행의
        #    EFT_ALL_AMT(22210000) 와 SAJEONG_PCT(87.545) 는 멀쩡하다.
        #    그걸 모르고 max 를 잡아서 xmax 중앙값이 560,048 이 나왔다 —
        #    비율이어야 하는 값이 백만 단위였다.
        #    두 경로로 각각 뽑아 서로 대조한다:
        #      x_A = EFT_ALL_AMT / (기초가·하한율/100)
        #      x_B = (SAJEONG_PCT/하한율) · R        (금액을 아예 안 지나간다)
        # 🔴 xmax 는 **철회 포함 전원**이어야 한다.
        #    낙찰자는 개찰 시점에 정해지고 철회는 그 뒤다. 따라서 생존 조건
        #        낙찰 ⟺ max_j x_j ≥ R
        #    의 j 는 개찰 시점의 전원이다. 철회를 빼면 xmax 가 과소평가되고,
        #    09 의 기각표집 제약이 과도하게 빡빡해져 영분포가 인위적으로 더
        #    음수가 된다 — 즉 "선택 편향이 전부 설명한다"는 결론이 공짜로 나온다.
        #    **판정을 유리한 쪽으로 미는 방향의 버그다.** 둘 다 저장해 대조한다.
        amts, ampct, wd, v = [], [], 0, [0] * 15
        amts_all, ampct_all = [], []
        va = [0] * 15          # 철회자 표까지 포함한 집계
        nv = nva = 0
        for r in ROW.findall(bb):
            row = dict(COL.findall(r))
            picks_all = [int(t) for t in NUM.findall(row.get("DRAW_NO") or "")]
            picks_all = [t for t in picks_all if 1 <= t <= 15]
            if picks_all:
                nva += 1
                for t in picks_all:
                    va[t - 1] += 1
            withdrawn = (row.get("WITHDRAWAL_YN") or "").strip() == "Y"
            if withdrawn:
                wd += 1
            try:
                a = float(row["EFT_ALL_AMT"]) / base
                if 0.5 < a < 5.0:
                    amts_all.append(a)
                    if not withdrawn:
                        amts.append(a)
            except Exception:
                pass
            try:
                sp = float(row["SAJEONG_PCT"])
                if 0 < sp < 500:
                    ampct_all.append(sp / fl)
                    if not withdrawn:
                        ampct.append(sp / fl)
            except Exception:
                pass
            if picks_all and not withdrawn:
                nv += 1
                for t in picks_all:
                    v[t - 1] += 1
        if not amts_all or not ampct_all:
            continue
        bid_id.append(bid)
        amax.append(max(amts_all))        # 🔴 철회 포함 — 생존 조건용
        amin.append(min(amts_all))
        pmax.append(max(ampct_all))
        pmin.append(min(ampct_all))
        amax_nw.append(max(amts) if amts else float("nan"))   # 철회 제외 — 대조용
        pmax_nw.append(max(ampct) if ampct else float("nan"))
        nbid.append(len(amts))
        nwd.append(wd)
        votes.append(v)
        votes_all.append(va)
        nvote.append(nv)
        nvote_all.append(nva)
        floor.append(fl)
        bgng.append(bg)
    return (np.array(bid_id, dtype="U16"),
            np.array(amax), np.array(amin),
            np.array(nbid, dtype=np.int32), np.array(nwd, dtype=np.int32),
            np.array(votes, dtype=np.int16).reshape(-1, 15),
            np.array(nvote, dtype=np.int32),
            np.array(floor), np.array(bgng),
            np.array(pmax), np.array(pmin),
            np.array(votes_all, dtype=np.int16).reshape(-1, 15),
            np.array(nvote_all, dtype=np.int32),
            np.array(amax_nw), np.array(pmax_nw))


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
    with Pool(12) as pool:
        for r in pool.imap_unordered(work, chunks):
            if len(r[0]):
                parts.append(r)
    cat = [np.concatenate([p[i] for p in parts]) for i in range(15)]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    np.savez_compressed(OUT, bid_id=cat[0], xmax=cat[1], xmin=cat[2],
                        nbid=cat[3], nwithdraw=cat[4], votes=cat[5],
                        nvoter=cat[6], floor=cat[7], bgng=cat[8],
                        pmax=cat[9], pmin=cat[10],
                        votes_all=cat[11], nvoter_all=cat[12],
                        xmax_nonwd=cat[13], pmax_nonwd=cat[14])
    print("회차 %d 저장 · %s (%.1f MB)" % (
        cat[0].shape[0], OUT, os.path.getsize(OUT) / 1e6))


if __name__ == "__main__":
    main()
