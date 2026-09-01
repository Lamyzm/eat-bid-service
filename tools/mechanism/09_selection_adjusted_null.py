# -*- coding: utf-8 -*-
"""007 낙찰 조건부 선택 편향을 귀무가설 **안에** 넣고 다시 검정한다.

## 문제

07 의 순열 검정은 관측 mean(D) = -2.00 bp 가 영분포(-0.63 bp) 밖이라고 말했다.
그런데 우리 코퍼스는 007 낙찰 전수다. 회차는

    낙찰 ⟺ max_j x_j >= R = mean(뽑힌 4개)

일 때만 007 이 된다. **R 이 낮게 나온 회차가 살아남는다.** 그러면 가격을 아무도
못 봐도 mean(D) < 0 이 나온다. 07 의 영분포는 이걸 안 넣었으므로 너무 높다.

## 해결: 기각표집 순열

귀무가설을 정확히 이렇게 쓴다.

    H0:  선택 슬롯집합 ⊥ 슬롯→가격 배정,
         **단 관측되려면 mean(뽑힌 4개) <= xmax 를 통과해야 한다**

순열에서 기증 마스크를 뽑되 `mean(rate_i[mask]) <= xmax_i` 를 만족할 때까지
다시 뽑는다. 이게 정확히 "가격을 못 보지만 낙찰된 회차만 관측된" 세계다.

xmax 는 H0 아래에서 보조통계량이다 — 가격을 못 보면 투찰금액은 가격 배정과
독립이므로, xmax 로 조건화해도 검정이 유효하다.

관측이 **이 영분포보다도** 낮으면, 선택 편향으로 설명되지 않는 몫이 남는 것이고
그건 투찰자가 가격을 본다는 뜻이다.

## 곁들여

  * `mean(상위4 후보) <= xmax` 인 회차는 **어떤 4개가 뽑혔어도 낙찰됐다.**
    거기엔 선택 편향이 원리적으로 없다. 순수 부분집합 칼.
  * DRAW_NO 실제 득표로 CHC_YN 이 최다득표 4개인지 전수 확인.
  * 득표수와 가격의 상관 — 가격 가시성의 직접 신호.
"""
from __future__ import annotations

import os
import sys

import numpy as np

MECH = os.environ.get("EATBID_MECH_DIR", r"F:/Project/eat-bid/data/mechanism")
RNG = np.random.default_rng(20260902)
NDONOR = 48          # 회차당 시도할 기증 마스크 수


def nbucket(n):
    b = np.full(n.shape, 6, dtype=np.int8)
    b[n <= 50] = 5
    b[n <= 25] = 4
    b[n <= 12] = 3
    b[n <= 6] = 2
    b[n <= 3] = 1
    b[n <= 1] = 0
    b[n < 0] = 7
    return b


def load():
    p = np.load(os.path.join(MECH, "plist.npz"))
    b = np.load(os.path.join(MECH, "bids.npz"))
    pid, bid = p["bid_id"], b["bid_id"]
    common, ip, ib = np.intersect1d(pid, bid, return_indices=True)
    print("조인 %d 회차 (plist %d · bids %d)" % (len(common), len(pid), len(bid)))
    d = {k: p[k][ip] for k in p.files if k != "bid_id"}
    for k in b.files:
        if k != "bid_id":
            d["b_" + k] = b[k][ib]
    d["bid_id"] = common
    return d


def perm_null(rate, chosen, cell, xmax, nperm, use_constraint):
    """셀 안에서 마스크를 섞되, use_constraint 면 mean<=xmax 를 통과할 때까지 다시 뽑는다."""
    n = rate.shape[0]
    out = np.empty(nperm)
    fail_rate = 0.0
    ucell, ci = np.unique(cell, return_inverse=True)
    groups = [np.flatnonzero(ci == k) for k in range(len(ucell))]
    for t in range(nperm):
        D = np.empty(n)
        nfail = 0
        for g in groups:
            r, ch = rate[g], chosen[g]
            m = len(g)
            pick = RNG.integers(0, m, size=(m, NDONOR))
            # cand[i,j] = mean(r[i] * ch[pick[i,j]])
            cand = np.einsum("ik,ijk->ij", r, ch[pick].astype(np.float64)) / 4.0
            if use_constraint:
                ok = cand <= xmax[g][:, None]
                first = np.argmax(ok, axis=1)
                none = ~ok.any(axis=1)
                nfail += int(none.sum())
                sel = cand[np.arange(m), first]
                sel[none] = (r[none] * ch[none]).sum(axis=1) / 4.0   # 낙오는 자기 것으로
            else:
                sel = cand[:, 0]
            D[g] = sel - r.mean(axis=1)
        out[t] = D.mean()
        fail_rate += nfail / n
    return out, fail_rate / nperm


def report(tag, obs, null, fail=None):
    nm, ns = null.mean(), null.std(ddof=1)
    le = int((null <= obs).sum())
    print("  %-28s 관측 %+8.4f  영평균 %+8.4f  영sd %6.4f  z %+7.2f  p %s%s" % (
        tag, obs * 1e4, nm * 1e4, ns * 1e4, (obs - nm) / ns,
        ("%.4f" % ((le + 1) / (len(null) + 1))) if le else "<%.4f" % (1.0 / (len(null) + 1)),
        "" if fail is None else "  (기각실패 %.2f%%)" % (fail * 100)))


def main():
    nperm = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    d = load()
    rate, chosen = d["rate"], d["chosen"]
    n = rate.shape[0]
    m15 = rate.mean(axis=1)
    R = (rate * chosen).sum(axis=1) / 4.0
    D = R - m15
    # 🔴 두 경로로 각각 만든 xmax 를 대조한 뒤에 쓴다.
    #    x_A 는 EFT_ALL_AMT/(기초가·하한율/100),
    #    x_B 는 (SAJEONG_PCT/하한율)·R 로 **금액을 아예 안 지나간다.**
    #    처음엔 BID_CALC_AMT 로 만들었다가 10^13 오염값에 걸렸다(중앙값 560,048).
    xA = d["b_xmax"]
    xB = d["b_pmax"] * R
    rel = np.abs(xA - xB) / np.maximum(1e-9, xB)
    print()
    print("xmax 두 경로 대조   |x_A−x_B|/x_B :  중앙 %.2e   <1e-3 인 회차 %.3f%%   <1e-2 %.3f%%" % (
        np.median(rel), 100 * (rel < 1e-3).mean(), 100 * (rel < 1e-2).mean()))
    good = (d["floor"] > 50) & np.isfinite(xB) & (rel < 1e-2)
    print("  하한율 정상(>50) 이고 두 경로가 1%% 안에서 맞는 회차만 쓴다: %d / %d (%.2f%%)" % (
        good.sum(), n, 100 * good.mean()))
    keep = good
    rate, chosen, R, D, m15 = rate[keep], chosen[keep], R[keep], D[keep], m15[keep]
    for k in list(d):
        try:
            d[k] = d[k][keep]
        except Exception:
            pass
    xmax = xB[keep]
    n = rate.shape[0]
    srt = np.sort(rate, axis=1)
    Rmax = srt[:, 11:].mean(axis=1)      # 가장 비싼 4개의 평균 = 가능한 최대 R
    Rmin = srt[:, :4].mean(axis=1)       # 가능한 최소 R
    nb = nbucket(d["bid_cnt"])
    cell = (d["year"].astype(np.int64) * 1000 + nb.astype(np.int64) * 100
            + np.clip(d["floor"].astype(np.int64), -1, 99))

    print()
    print("=" * 92)
    print("낙찰 조건 확인   낙찰 ⟺ xmax >= R")
    print("=" * 92)
    print("  xmax >= R          %7.3f%%   ← 007 전수이므로 100%% 여야 한다" % (100 * (xmax >= R - 1e-9).mean()))
    print("  xmax >= Rmax       %7.3f%%   ← 어떤 4개가 뽑혔어도 낙찰됐다 (선택 편향 없음)" % (100 * (xmax >= Rmax).mean()))
    print("  xmax <  Rmin       %7.3f%%   ← 어떤 4개로도 낙찰 불가. 0%% 여야 한다" % (100 * (xmax < Rmin).mean()))
    print("  여유 xmax−R  중앙 %+.5f  p10 %+.5f  p90 %+.5f" % (
        np.median(xmax - R), np.quantile(xmax - R, .1), np.quantile(xmax - R, .9)))

    print()
    print("=" * 92)
    print("① 순수 부분집합 칼   xmax >= Rmax 인 회차만")
    print("=" * 92)
    safe = xmax >= Rmax
    print("  회차 %d (%.1f%%)   mean(D) = %+.4f bp   [전체 %+.4f bp]" % (
        safe.sum(), 100 * safe.mean(), D[safe].mean() * 1e4, D.mean() * 1e4))
    if safe.sum() > 2000:
        nl, _ = perm_null(rate[safe], chosen[safe], cell[safe], xmax[safe], nperm, False)
        report("안전 부분집합 (제약없음)", D[safe].mean(), nl)
    print("  주: 이 부분집합은 경쟁이 센 회차로 치우친다. 효과가 사라져도 그것만으로는")
    print("      '선택 편향이었다' 가 아니라 '센 회차엔 원래 효과가 없다' 일 수 있다.")

    print()
    print("=" * 92)
    print("② 기각표집 순열   선택 편향을 귀무 안에 넣는다   (%d 회)" % nperm)
    print("=" * 92)
    nl0, _ = perm_null(rate, chosen, cell, xmax, nperm, False)
    report("H0 (선택편향 미반영)", D.mean(), nl0)
    nl1, f1 = perm_null(rate, chosen, cell, xmax, nperm, True)
    report("H0 (선택편향 반영)", D.mean(), nl1, f1)
    print()
    print("  🔴 두 번째 줄이 판정이다. 관측이 여기서도 유의하게 낮으면")
    print("     007 조건부 선택으로 설명되지 않는 몫이 남는 것 —— 가격을 본다는 뜻이다.")

    print()
    print("  N 구간별 (선택편향 반영)")
    names = {0: "01", 1: "02-03", 2: "04-06", 3: "07-12", 4: "13-25", 5: "26-50", 6: "51+", 7: "N없음"}
    sub = max(60, nperm // 3)
    for k in sorted(names):
        s = nb == k
        if s.sum() < 500:
            continue
        c2 = d["year"][s].astype(np.int64) * 100 + np.clip(d["floor"][s].astype(np.int64), -1, 99)
        nlk, fk = perm_null(rate[s], chosen[s], c2, xmax[s], sub, True)
        report("  N=%-6s n=%6d" % (names[k], s.sum()), D[s].mean(), nlk, fk)

    print()
    print("=" * 92)
    print("③ DRAW_NO 실제 득표 검증")
    print("=" * 92)
    v = d["b_votes"].astype(np.float64)
    nv = d["b_nvoter"]
    has = nv > 0
    print("  투표가 하나라도 있는 회차 %.2f%%   투표자/입찰자 비 중앙 %.3f" % (
        100 * has.mean(), np.median(nv[has] / np.maximum(1, d["b_nbid"][has]))))
    # 최다득표 4개 == CHC_YN 인가 (동점은 애매하므로 따로 센다)
    ok = has & (v.sum(axis=1) == 2 * nv)
    vv = v[ok]
    ch = chosen[ok]
    ordv = np.argsort(-vv, axis=1, kind="stable")
    top4 = np.zeros_like(ch)
    np.put_along_axis(top4, ordv[:, :4], True, axis=1)
    exact = (top4 == ch).all(axis=1)
    # 4위와 5위가 동점인 회차 = 규칙이 안 정해지는 회차
    s4 = np.take_along_axis(vv, ordv[:, 3:4], axis=1)[:, 0]
    s5 = np.take_along_axis(vv, ordv[:, 4:5], axis=1)[:, 0]
    tie = s4 == s5
    print("  최다득표 4개 == CHC_YN :  전체 %.3f%%  (n=%d)" % (100 * exact.mean(), ok.sum()))
    print("    4위-5위 동점 아닌 회차 %.3f%%  (n=%d)" % (
        100 * exact[~tie].mean(), (~tie).sum()))
    print("    4위-5위 동점 회차     %.3f%%  (n=%d)  ← 여기가 tie-break 규칙이 사는 곳" % (
        100 * exact[tie].mean(), tie.sum()))
    print("  동점일 때 뽑힌 쪽이 번호가 작은가: ", end="")
    tv, tc, to = vv[tie], ch[tie], ordv[tie]
    if tie.sum():
        low = 0
        for i in range(min(20000, tie.sum())):
            cand = np.flatnonzero(tv[i] == s4[tie][i])
            picked = [c for c in cand if tc[i][c]]
            if picked and len(cand) > 1:
                low += int(min(picked) == min(cand))
        print("%d 건 표본에서 %.1f%%" % (min(20000, tie.sum()), 100 * low / max(1, min(20000, tie.sum()))))
    else:
        print("동점 없음")

    print()
    print("=" * 92)
    print("④ 득표수와 가격의 관계 — 가격 가시성의 직접 신호")
    print("=" * 92)
    cen = rate - rate.mean(axis=1, keepdims=True)
    for tag, sel in (("전체", has), ("안전 부분집합", has & safe)):
        vs = v[sel]
        cs = cen[sel]
        vc = vs - vs.mean(axis=1, keepdims=True)
        num = (vc * cs).sum(axis=1)
        den = np.sqrt((vc ** 2).sum(axis=1) * (cs ** 2).sum(axis=1))
        r = num / np.where(den == 0, np.nan, den)
        r = r[np.isfinite(r)]
        print("  %-14s 회차별 corr(득표수, 중심화가격) 평균 %+.5f  sd %.5f  SE %.5f  z %+.2f  (n=%d)" % (
            tag, r.mean(), r.std(ddof=1), r.std(ddof=1) / np.sqrt(len(r)),
            r.mean() / (r.std(ddof=1) / np.sqrt(len(r))), len(r)))
    print("  주: '전체' 는 007 선택 편향에 오염된다(싸게 뽑힌 회차가 살아남으므로).")
    print("      '안전 부분집합' 은 안 그렇다. 거기서도 음수면 가격을 본다는 뜻이다.")


if __name__ == "__main__":
    main()
