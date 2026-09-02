# -*- coding: utf-8 -*-
"""모듈 책임: 투찰자가 예비가격 15개를 보고 찍는가 — 순열 검정.

## 04 의 귀무가설이 너무 셌다

04 는 "선택 4개가 15개의 균등 부분집합"을 귀무로 놓고 z=-12.96 으로 기각했다.
그런데 그 귀무는 **틀린 귀무**다. 투표가 슬롯 번호에 심하게 쏠려 있으므로
(seq3 0.732 vs seq14 0.013) 선택은 균등일 리가 없다. 균등을 기각한 건
"가격을 본다"가 아니라 "투표가 쏠려 있다"를 다시 말한 것일 수 있다.

## 옳은 귀무는 이것이다

    H0:  선택된 슬롯 집합  ⊥  슬롯→가격 배정

투찰자가 가격을 못 보면, 무엇을 근거로 찍든(미신·습관·N) 그 선택은 **그 회차의
가격 배정과 독립**이어야 한다. 가격 배정 쪽에 미세한 구조가 있어도(실측: 슬롯번호와
가격의 Spearman +0.00488, z=+8.85) H0 는 여전히 성립한다 — 독립이면 되지
무작위일 필요는 없다.

H0 아래 E[D] 는 0 이 아니라 (1/4)*sum_s p_s*delta_s 다. 이게 04 가 놓친 것이다.

## 검정 방법: 셀 안에서 선택 마스크를 회차끼리 섞는다

마스크(15칸 bool, 4개 True)를 통째로 다른 회차의 가격판에 붙인다.
  * 투표 쏠림 구조는 **그대로 보존된다** (마스크를 쪼개지 않는다)
  * 가격과의 연결만 끊긴다
셀(연도 x N구간 x 하한율) 안에서만 섞어 교환가능성을 지킨다.

관측 mean(D) 가 이 순열 영분포 밖에 있으면, 선택이 가격을 안다는 뜻이다.
그건 곧 **개찰 전에 15개 가격이 보인다**는 직접 증거다.
"""
from __future__ import annotations

import os
import sys

import numpy as np

NPZ = os.environ.get("EATBID_MECH_NPZ", r"F:/Project/eat-bid/data/mechanism/plist.npz")
RNG = np.random.default_rng(20260902)


def nbucket(n):
    b = np.full(n.shape, 6, dtype=np.int8)
    b[n <= 50] = 5
    b[n <= 25] = 4
    b[n <= 12] = 3
    b[n <= 6] = 2
    b[n <= 3] = 1
    b[n <= 1] = 0
    b[n < 0] = 7          # BID_CNT 없음
    return b


def main():
    nperm = int(sys.argv[1]) if len(sys.argv) > 1 else 400
    z = np.load(NPZ)
    rate, chosen = z["rate"], z["chosen"]
    n = rate.shape[0]
    m = rate.mean(axis=1, keepdims=True)
    cen = rate - m                                  # 회차 내 중심화 가격
    D = (cen * chosen).sum(axis=1) / 4.0            # = mean(선택4) - mean(15)
    obs = D.mean()

    print("=" * 78)
    print("관측  n=%d   mean(D) = %+.4f bp" % (n, obs * 1e4))
    print("=" * 78)

    # ---- 층화 셀 ----
    nb = nbucket(z["bid_cnt"])
    yr = z["year"].astype(np.int64)
    fl = z["floor"].astype(np.int64)
    cell = (yr - yr.min()) * 1000 + nb.astype(np.int64) * 100 + np.clip(fl, -1, 99)
    ucell, cidx = np.unique(cell, return_inverse=True)
    print("셀 %d 개 (연도 x N구간 x 하한율)   최대 %d · 중앙 %d 회차" % (
        len(ucell), np.bincount(cidx).max(), int(np.median(np.bincount(cidx)))))

    # ---- 해석적 분해 (층화) ----
    print()
    print("-" * 78)
    print("해석적 분해   E[D] = (A) 독립 하 기대값 + (B) 독립 위반")
    print("-" * 78)
    for label, key in (("층화 없음", np.zeros(n, dtype=np.int64)),
                       ("연도", yr),
                       ("N구간", nb.astype(np.int64)),
                       ("연도xN구간", yr * 10 + nb),
                       ("연도xN구간x하한율", cidx)):
        u, ci = np.unique(key, return_inverse=True)
        A = 0.0
        b_i = np.empty(n)
        for k in range(len(u)):
            sel = ci == k
            if sel.sum() < 20:
                b_i[sel] = 0.0
                continue
            p = chosen[sel].mean(axis=0)            # 셀 안 슬롯별 한계 선택확률
            d = cen[sel].mean(axis=0)               # 셀 안 슬롯별 평균 중심화 가격
            A += sel.sum() * (p * d).sum() / 4.0
            b_i[sel] = ((chosen[sel] - p) * cen[sel]).sum(axis=1) / 4.0
        A /= n
        B = b_i.mean()
        seB = b_i.std(ddof=1) / np.sqrt(n)
        print("  %-20s (A) %+7.4f bp   (B) %+7.4f bp  SE %.4f  z=%+7.2f" % (
            label, A * 1e4, B * 1e4, seB * 1e4, B / seB))

    # ---- 순열 검정 ----
    print()
    print("-" * 78)
    print("순열 검정   H0: 선택 슬롯집합 ⊥ 슬롯→가격 배정   (%d 회)" % nperm)
    print("-" * 78)
    order = np.argsort(cidx, kind="stable")
    starts = np.searchsorted(cidx[order], np.arange(len(ucell)))
    ends = np.searchsorted(cidx[order], np.arange(len(ucell)), side="right")
    null = np.empty(nperm)
    for t in range(nperm):
        perm = np.empty(n, dtype=np.int64)
        for a, b in zip(starts, ends):
            g = order[a:b]
            perm[g] = RNG.permutation(g)
        null[t] = (cen * chosen[perm]).sum(axis=1).mean() / 4.0
    nm, ns = null.mean(), null.std(ddof=1)
    print("  영분포  mean %+.4f bp   sd %.4f bp" % (nm * 1e4, ns * 1e4))
    print("  관측    %+.4f bp" % (obs * 1e4))
    print("  z = (관측 − 영평균)/영sd = %+.2f" % ((obs - nm) / ns))
    ge = int((null <= obs).sum())
    print("  영분포 중 관측 이하 %d/%d  →  단측 p %s" % (
        ge, nperm, ("%.4f" % ((ge + 1) / (nperm + 1))) if ge else "< %.4f" % (1.0 / (nperm + 1))))
    print()
    print("  주: 영분포 평균이 0 이 아니라 %+.4f bp 인 것이 핵심이다 —" % (nm * 1e4))
    print("      그게 04 가 균등 귀무로 놓쳐서 (A) 로 잘못 넘긴 몫이다.")

    # ---- N 구간별 순열 z ----
    print()
    print("-" * 78)
    print("N 구간별 (같은 순열 얼개, 셀은 연도x하한율)")
    print("-" * 78)
    names = {0: "01", 1: "02-03", 2: "04-06", 3: "07-12", 4: "13-25", 5: "26-50",
             6: "51+", 7: "N없음"}
    sub = max(80, nperm // 4)
    print("  %-8s %8s %12s %12s %8s" % ("N", "회차", "관측 bp", "영평균 bp", "z"))
    for bkt in sorted(names):
        sel = nb == bkt
        if sel.sum() < 200:
            continue
        c2 = (yr[sel] * 100 + np.clip(fl[sel], -1, 99))
        u2, ci2 = np.unique(c2, return_inverse=True)
        cen2, ch2 = cen[sel], chosen[sel]
        o2 = (cen2 * ch2).sum(axis=1).mean() / 4.0
        ord2 = np.argsort(ci2, kind="stable")
        st2 = np.searchsorted(ci2[ord2], np.arange(len(u2)))
        en2 = np.searchsorted(ci2[ord2], np.arange(len(u2)), side="right")
        nl = np.empty(sub)
        for t in range(sub):
            pm = np.empty(sel.sum(), dtype=np.int64)
            for a, b in zip(st2, en2):
                g = ord2[a:b]
                pm[g] = RNG.permutation(g)
            nl[t] = (cen2 * ch2[pm]).sum(axis=1).mean() / 4.0
        print("  %-8s %8d %+12.4f %+12.4f %+8.2f" % (
            names[bkt], sel.sum(), o2 * 1e4, nl.mean() * 1e4,
            (o2 - nl.mean()) / nl.std(ddof=1)))


if __name__ == "__main__":
    main()
