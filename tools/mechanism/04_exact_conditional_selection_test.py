# -*- coding: utf-8 -*-
"""모듈 책임: 4개 선정이 15개의 균등 부분집합인가 — 전수, 정확 조건부 검정.

왜 KS 가 아니라 이것인가:
  ml-expert 의 측정 5 는 같은 15개에서 4개를 뽑은 **모의** 대조군과 KS 로 겨뤘다.
  그 대조군은 옳지만 두 가지 낭비가 있다.
    (1) 모의라서 대조군 자신의 잡음이 검정력을 깎는다.
    (2) KS 는 분포 전체의 모양 차이를 보는 통계량이라, **평균이 살짝 밀린 것**에
        대해 검정력이 거의 없다. 실제로 우리가 본 차이는 위치 이동뿐이다.

  대신 여기서는 귀무가설의 조건부 기댓값을 **닫힌 형태로** 쓴다.
  회차 i 의 후보 비율 r_1..r_15 가 주어졌을 때, 4개가 균등 부분집합이면
      E[mean(선택 4개)] = mean(r)                        (정확)
      Var[mean(선택 4개)] = (v_i/4)*(11/14),  v_i = 모분산 (정확, 유한모집단 보정)
  따라서 D_i = mean(선택 4개) - mean(r_i) 는 평균 0 의 정확한 축이고,
      z = sum(D_i) / sqrt(sum(Var_i))
  는 후보 생성 분포가 **무엇이든** 상관없이 유효하다 - 균등이든 아니든 조건부로 지워진다.

  이게 중요한 이유: 리더 측정에서 후보 분포는 U(0.97,1.03) 이 아니다(1.0 바로 아래 봉우리).
  그래서 "균등 가정" 위에 선 해석해와 모의는 전부 다시 재야 하는데, 이 검정만은 그 가정을
  아예 쓰지 않는다.
"""
from __future__ import annotations

import glob
import gzip
import math
import os
import re
import sys
from collections import Counter, defaultdict
from multiprocessing import Pool

ROOT = os.environ.get("EATBID_RAW", r"F:/Project/eat-bid/data/raw/internal")

DS = re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>', re.S)
ROW = re.compile(r"<Row>(.*?)</Row>", re.S)
COL = re.compile(r'<Col id="([^"]+)">(.*?)</Col>', re.S)

# 후보 비율 히스토그램 눈금 - +-3% 지지집합을 0.0005 폭으로 자른다
HB_LO, HB_HI, HB_W = 0.9650, 1.0350, 0.0005
HB_N = int(round((HB_HI - HB_LO) / HB_W))


def nbucket(n):
    if n <= 1:
        return "01"
    if n <= 3:
        return "02-03"
    if n <= 6:
        return "04-06"
    if n <= 12:
        return "07-12"
    if n <= 25:
        return "13-25"
    if n <= 50:
        return "26-50"
    return "51+"


def work(paths):
    acc = {
        "n": 0, "sumD": 0.0, "sumVar": 0.0, "sumD2": 0.0,
        "byN": {},          # bucket -> [n, sumD, sumVar]
        "byYear": {},
        "hist": [0] * HB_N,
        "cand_n": 0, "cand_sum": 0.0, "cand_sum2": 0.0,
        "chosen_by_seq": Counter(), "seq_total": Counter(),
        "R_resid_n": 0, "R_resid_max": 0.0, "R_resid_sum": 0.0, "R_resid_bad": 0,
        "skip_np15": 0, "skip_chc": 0, "skip_parse": 0, "files": 0,
        "status": Counter(),
    }
    for p in paths:
        acc["files"] += 1
        try:
            s = gzip.open(p, "rt", encoding="utf-8", errors="replace").read()
        except Exception:
            acc["skip_parse"] += 1
            continue
        blocks = dict(DS.findall(s))
        pbody = blocks.get("ds_pList")
        if not pbody:
            acc["skip_np15"] += 1
            continue
        rows = [dict(COL.findall(r)) for r in ROW.findall(pbody)]
        if len(rows) != 15:
            acc["skip_np15"] += 1
            continue
        try:
            rates = [float(r["CMNM_PLNPRC_RT"]) for r in rows]
            seqs = [int(float(r["CMNM_PLNPRC_SN"])) for r in rows]
        except Exception:
            acc["skip_parse"] += 1
            continue
        chc = [(r.get("CHC_YN") or "").strip() == "Y" for r in rows]
        if sum(chc) != 4:
            acc["skip_chc"] += 1
            continue

        # 후보 분포 (조건부 검정과 무관하지만 같은 스캔에서 공짜로 얻는다)
        for v in rates:
            acc["cand_n"] += 1
            acc["cand_sum"] += v
            acc["cand_sum2"] += v * v
            b = int((v - HB_LO) / HB_W)
            if 0 <= b < HB_N:
                acc["hist"][b] += 1
        for sq, c in zip(seqs, chc):
            acc["seq_total"][sq] += 1
            if c:
                acc["chosen_by_seq"][sq] += 1

        m = sum(rates) / 15.0
        v = sum((x - m) ** 2 for x in rates) / 15.0          # 모분산
        Rc = sum(x for x, c in zip(rates, chc) if c) / 4.0
        D = Rc - m
        Var = (v / 4.0) * (11.0 / 14.0)                       # 유한모집단 보정
        acc["n"] += 1
        acc["sumD"] += D
        acc["sumD2"] += D * D
        acc["sumVar"] += Var

        ibody = blocks.get("ds_info")
        N = None
        year = None
        if ibody:
            irow = ROW.search(ibody)
            info = dict(COL.findall(irow.group(1))) if irow else {}
            acc["status"][(info.get("ELCTRN_BID_STAT_CD") or "").strip()] += 1
            try:
                N = int(float(info.get("BID_CNT") or "nan"))
            except Exception:
                N = None
            year = (info.get("REGYYYY") or "").strip()
            # R 보고값이 정말 선택 4개의 평균인가
            try:
                bg = float(info["BGNG_PRC"])
                pl = float(info["ELCTRN_BID_PLNPRC"])
                if bg > 0:
                    resid = pl / bg - Rc
                    acc["R_resid_n"] += 1
                    acc["R_resid_sum"] += resid
                    if abs(resid) > acc["R_resid_max"]:
                        acc["R_resid_max"] = abs(resid)
                    if abs(resid) > 1e-4:
                        acc["R_resid_bad"] += 1
            except Exception:
                pass
        if N is not None:
            b = acc["byN"].setdefault(nbucket(N), [0, 0.0, 0.0])
            b[0] += 1
            b[1] += D
            b[2] += Var
        if year and year.isdigit():
            b = acc["byYear"].setdefault(year, [0, 0.0, 0.0])
            b[0] += 1
            b[1] += D
            b[2] += Var
    return acc


def merge(a, b):
    for k in ("n", "sumD", "sumVar", "sumD2", "cand_n", "cand_sum", "cand_sum2",
              "R_resid_n", "R_resid_sum", "R_resid_bad",
              "skip_np15", "skip_chc", "skip_parse", "files"):
        a[k] += b[k]
    a["R_resid_max"] = max(a["R_resid_max"], b["R_resid_max"])
    a["hist"] = [x + y for x, y in zip(a["hist"], b["hist"])]
    for k in ("chosen_by_seq", "seq_total", "status"):
        a[k].update(b[k])
    for key in ("byN", "byYear"):
        for kk, vv in b[key].items():
            t = a[key].setdefault(kk, [0, 0.0, 0.0])
            t[0] += vv[0]
            t[1] += vv[1]
            t[2] += vv[2]
    return a


def main():
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else 0
    files = []
    for d in sorted(os.listdir(ROOT)):
        files += glob.glob(os.path.join(ROOT, d, "*.xml.gz"))
    files.sort()
    if limit and limit < len(files):
        step = len(files) // limit
        files = files[::step][:limit]
    print("파일 %d 개" % len(files), flush=True)

    chunks = [files[i::48] for i in range(48)]
    chunks = [c for c in chunks if c]
    base = None
    with Pool(12) as pool:
        for i, acc in enumerate(pool.imap_unordered(work, chunks)):
            base = acc if base is None else merge(base, acc)
            print("  ...%d/%d 청크" % (i + 1, len(chunks)), flush=True)
    a = base

    print()
    print("=" * 74)
    print("정확 조건부 검정  H0: 선택 4개는 15개의 균등 부분집합")
    print("=" * 74)
    n, sD, sV = a["n"], a["sumD"], a["sumVar"]
    mean_D = sD / n
    se = math.sqrt(sV) / n
    z = sD / math.sqrt(sV)
    obs_sd = math.sqrt(max(0.0, a["sumD2"] / n - mean_D ** 2))
    null_sd = math.sqrt(sV / n)
    print("  회차 n            = %d" % n)
    print("  mean(D)           = %+.7f  (%+.3f bp)" % (mean_D, mean_D * 1e4))
    print("  귀무 SE           =  %.7f  (%.3f bp)   <- 모의 아님, 닫힌 형태" % (se, se * 1e4))
    print("  z                 = %+.2f" % z)
    print("  실측 sd(D) %.7f   귀무 sd(D) %.7f   비 %.4f" % (obs_sd, null_sd, obs_sd / null_sd))
    print()
    print("  N 구간별 (선택 편향이 경쟁자 수에 따라 달라지는가)")
    print("  %-8s %8s %12s %10s %8s" % ("N", "회차", "mean(D) bp", "SE bp", "z"))
    for k in sorted(a["byN"]):
        c, d, v = a["byN"][k]
        if c < 30:
            continue
        print("  %-8s %8d %+12.3f %10.3f %+8.2f" % (
            k, c, (d / c) * 1e4, (math.sqrt(v) / c) * 1e4, d / math.sqrt(v)))
    print()
    print("  연도별")
    for k in sorted(a["byYear"]):
        c, d, v = a["byYear"][k]
        if c < 30:
            continue
        print("  %-8s %8d %+12.3f %10.3f %+8.2f" % (
            k, c, (d / c) * 1e4, (math.sqrt(v) / c) * 1e4, d / math.sqrt(v)))

    print()
    print("=" * 74)
    print("후보 15개 분포 (조건부 검정과 무관 - 별개 사실)")
    print("=" * 74)
    cn, cs, cs2 = a["cand_n"], a["cand_sum"], a["cand_sum2"]
    cm = cs / cn
    csd = math.sqrt(cs2 / cn - cm * cm)
    print("  n=%d  mean=%.6f (%+.2f bp vs 1.0)  sd=%.6f   균등이론 sd=%.6f" % (
        cn, cm, (cm - 1) * 1e4, csd, 0.06 / math.sqrt(12)))
    exp = cn / 120.0   # 균등이면 0.97~1.03 을 0.0005 폭으로 120칸
    print("  칸별 균등 대비 (지지집합 안쪽만)")
    for b in range(HB_N):
        lo = HB_LO + b * HB_W
        c = a["hist"][b]
        if c == 0 and not (0.9695 <= lo <= 1.0300):
            continue
        dev = (c / exp - 1) * 100 if exp else 0
        bar = "#" * min(60, int(abs(dev) * 1.2))
        print("   [%.4f,%.4f) %9d %+7.1f%% %s" % (lo, lo + HB_W, c, dev, bar))

    print()
    print("=" * 74)
    print("부수 확인")
    print("=" * 74)
    print("  R(=ELCTRN_BID_PLNPRC/BGNG_PRC) - mean(선택4) :")
    print("    n=%d  mean=%+.3e  max|.|=%.3e  |resid|>1e-4 인 회차 %d 건 (%.3f%%)" % (
        a["R_resid_n"], a["R_resid_sum"] / max(1, a["R_resid_n"]),
        a["R_resid_max"], a["R_resid_bad"], 100.0 * a["R_resid_bad"] / max(1, a["R_resid_n"])))
    print("  슬롯번호별 선택률 (균등이면 0.2667)")
    for sq in range(1, 16):
        t = a["seq_total"][sq]
        if t:
            print("    seq %2d  %.4f  (n=%d)" % (sq, a["chosen_by_seq"][sq] / t, t))
    print("  상태코드:", a["status"].most_common(6))
    print("  파일 %d  · pList!=15 %d · CHC!=4 %d · 파싱실패 %d" % (
        a["files"], a["skip_np15"], a["skip_chc"], a["skip_parse"]))


if __name__ == "__main__":
    main()
