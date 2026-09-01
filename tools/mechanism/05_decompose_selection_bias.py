# -*- coding: utf-8 -*-
"""04 가 찾은 mean(D) = -2.0 bp (z=-12.96) 를 두 갈래로 가른다.

D_i = mean(선택 4개)_i - mean(r)_i,  전수 평균 -2.0 bp.
슬롯 지시자 c_s 와 회차 내 중심화 가격 (r_s - m) 으로 쓰면

    E[D] = (1/4) * sum_s E[ c_s * (r_s - m) ]

이걸 둘로 가른다.

  (A) 슬롯 한계 편향   = (1/4) * sum_s p_s * delta_s
        p_s     = 슬롯 s 가 뽑힐 한계 확률   (투표 쏠림. 04 에서 이미 잼)
        delta_s = E[r_s - m]                (슬롯 번호가 가격을 미세하게 아는가)
      c_s 가 가격과 **독립**이면 E[D] 는 정확히 이 값이다.
      즉 이건 "슬롯↔가격 무작위화가 완벽하지 않다" 하나로 설명되는 몫이다.

  (B) 잔차 = 실측 E[D] - (A)
      c_s 가 같은 슬롯 안에서도 **가격이 낮을 때 더 자주 뽑힌다**는 뜻이다.
      슬롯 번호만 보고는 만들 수 없는 상관이다.

🔴 (B) 가 0 이 아니면 그건 **투찰자가 가격을 보고 찍는다**는 뜻이고,
   "15개 예비가격이 개찰 전 비공개인가" 라는 질문에 대한 직접 답이 된다.
   물어볼 필요 없이 재서 답한다.

부수로 회차별 Spearman(seq, rate) 을 전수로 재서 표준오차와 함께 낸다
(ml-expert 는 표본 4,000 에서 평균 0.012 를 봤다 — 0 인지 아닌지가 안 갈렸다).
"""
from __future__ import annotations

import glob
import gzip
import math
import os
import re
import sys
from collections import Counter
from multiprocessing import Pool

ROOT = os.environ.get("EATBID_RAW", r"F:/Project/eat-bid/data/raw/internal")

DS = re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>', re.S)
ROW = re.compile(r"<Row>(.*?)</Row>", re.S)
COL = re.compile(r'<Col id="([^"]+)">(.*?)</Col>', re.S)


def rankcorr15(xs):
    """xs[k] = 슬롯 k+1 의 가격. seq 는 이미 1..15 순서이므로 seq 순위는 0..14."""
    order = sorted(range(15), key=lambda i: xs[i])
    ry = [0] * 15
    for rank, i in enumerate(order):
        ry[i] = rank
    d2 = sum((i - ry[i]) ** 2 for i in range(15))
    return 1 - 6.0 * d2 / (15 * (225 - 1))


def work(paths):
    a = {
        "n": 0,
        "sumD": 0.0, "sumVar": 0.0,
        "chosen": [0] * 16,            # 슬롯별 뽑힌 횟수
        "delta": [0.0] * 16,           # 슬롯별 sum(r_s - m)
        "cdelta": [0.0] * 16,          # 슬롯별 sum(c_s * (r_s - m))  <- 실측 결합
        "sp": 0.0, "sp2": 0.0,
        "skip": 0,
    }
    for p in paths:
        try:
            s = gzip.open(p, "rt", encoding="utf-8", errors="replace").read()
        except Exception:
            a["skip"] += 1
            continue
        blocks = dict(DS.findall(s))
        pbody = blocks.get("ds_pList")
        if not pbody:
            a["skip"] += 1
            continue
        rows = [dict(COL.findall(r)) for r in ROW.findall(pbody)]
        if len(rows) != 15:
            a["skip"] += 1
            continue
        try:
            byseq = {}
            for r in rows:
                byseq[int(float(r["CMNM_PLNPRC_SN"]))] = (
                    float(r["CMNM_PLNPRC_RT"]),
                    (r.get("CHC_YN") or "").strip() == "Y",
                )
        except Exception:
            a["skip"] += 1
            continue
        if len(byseq) != 15 or set(byseq) != set(range(1, 16)):
            a["skip"] += 1
            continue
        rates = [byseq[k][0] for k in range(1, 16)]
        chc = [byseq[k][1] for k in range(1, 16)]
        if sum(chc) != 4:
            a["skip"] += 1
            continue

        m = sum(rates) / 15.0
        v = sum((x - m) ** 2 for x in rates) / 15.0
        a["n"] += 1
        a["sumD"] += sum(x for x, c in zip(rates, chc) if c) / 4.0 - m
        a["sumVar"] += (v / 4.0) * (11.0 / 14.0)
        for i in range(15):
            d = rates[i] - m
            a["delta"][i + 1] += d
            if chc[i]:
                a["chosen"][i + 1] += 1
                a["cdelta"][i + 1] += d
        rho = rankcorr15(rates)
        a["sp"] += rho
        a["sp2"] += rho * rho
    return a


def merge(x, y):
    for k in ("n", "sumD", "sumVar", "sp", "sp2", "skip"):
        x[k] += y[k]
    for k in ("chosen", "delta", "cdelta"):
        x[k] = [p + q for p, q in zip(x[k], y[k])]
    return x


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
    base = None
    with Pool(12) as pool:
        for acc in pool.imap_unordered(work, chunks):
            base = acc if base is None else merge(base, acc)
    a = base
    n = a["n"]

    print()
    print("=" * 78)
    print("mean(D) 분해   n=%d 회차" % n)
    print("=" * 78)
    obsD = a["sumD"] / n
    se = math.sqrt(a["sumVar"]) / n
    print("  실측 E[D]              = %+.4f bp   (귀무 SE %.4f bp, z=%+.2f)" % (
        obsD * 1e4, se * 1e4, a["sumD"] / math.sqrt(a["sumVar"])))

    # (A) 슬롯 한계 편향
    partA = 0.0
    for s in range(1, 16):
        p_s = a["chosen"][s] / n
        d_s = a["delta"][s] / n
        partA += p_s * d_s
    partA /= 4.0
    print("  (A) 슬롯 한계 편향     = %+.4f bp   = (1/4)·Σ p_s·δ_s" % (partA * 1e4))
    print("  (B) 잔차               = %+.4f bp   = 실측 − (A)" % ((obsD - partA) * 1e4))
    print()
    print("     (A) 는 '슬롯↔가격 무작위화가 완벽하지 않다' 하나로 설명되는 몫이다.")
    print("     (B) 는 같은 슬롯 안에서도 가격이 낮을 때 더 뽑힌다는 뜻이다 —")
    print("     🔴 (B)≠0 이면 투찰자가 가격을 본다는 직접 증거다.")
    print()
    print("  %-5s %10s %12s %14s %14s" % ("슬롯", "p_s", "δ_s (bp)", "p_s·δ_s/4 (bp)", "실측 결합/4 (bp)"))
    for s in range(1, 16):
        p_s = a["chosen"][s] / n
        d_s = a["delta"][s] / n
        print("  %-5d %10.4f %12.3f %14.4f %14.4f" % (
            s, p_s, d_s * 1e4, p_s * d_s / 4 * 1e4, a["cdelta"][s] / n / 4 * 1e4))
    print("  %-5s %10.4f %12.3f %14.4f %14.4f" % (
        "합", sum(a["chosen"][1:]) / n, sum(a["delta"][1:]) / n * 1e4,
        partA * 1e4, sum(a["cdelta"][1:]) / n / 4 * 1e4))

    print()
    print("=" * 78)
    print("회차별 Spearman(슬롯번호, 가격) — 전수")
    print("=" * 78)
    mrho = a["sp"] / n
    sdrho = math.sqrt(max(0.0, a["sp2"] / n - mrho * mrho))
    print("  평균 %+.5f   sd %.5f   SE %.5f   z=%+.2f" % (
        mrho, sdrho, sdrho / math.sqrt(n), mrho / (sdrho / math.sqrt(n))))
    print("  무작위 순열 이론 sd = 1/√14 = %.5f" % (1 / math.sqrt(14)))
    print("  건너뛴 파일 %d" % a["skip"])


if __name__ == "__main__":
    main()
