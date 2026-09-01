# -*- coding: utf-8 -*-
"""안전 부분집합의 +0.56 bp 가 진짜인가, M 이 R 에 오염된 산물인가.

## stats-expert 의 항등식이 문제를 한 곳으로 몰았다

H0(mask ⊥ 가격배정) 아래
    E[D | r] = (1/4)·Σ_s (p_s − 4/15)·r_s
는 **r 과 p_s 에만 의존한다.** 따라서 **r 만의 함수로 회차를 골라도 E[D] 는 안 움직인다.**
`Rmax`(=상위4 후보 평균)도, 후보분산도 전부 r 만의 함수다.

그런데 안전 부분집합은 `safe = 1{M ≥ Rmax}` 로, **r 과 M 의 함수다.**
∴ 편향이 생겼다면 **반드시 M 을 통해서다.**

## 그래서 M 이 R 을 지나가는지만 확인하면 된다

투찰은 R 이 뽑히기 전에 정해진다. **올바른 M 은 R 과 거의 독립이어야 한다.**
유의한 상관이면 M 이 오염된 것이고 +0.56 은 그 산물이다.

⚠ 값이 맞는 것과 **행 선택**이 맞는 것은 다르다. 두 경로 99.98% 일치는 값 얘기다.
   `ETC='낙찰 기준 미달'` 은 `bid < 하한율·예정가` 이므로 **R 의 함수다.**
   그 행이 빠지면 M 이 오염된다. 그래서 필터가 무엇을 떨어뜨렸는지도 같이 센다.
"""
from __future__ import annotations

import os

import numpy as np
from scipy import stats as sps

MECH = os.environ.get("EATBID_MECH_DIR", r"F:/Project/eat-bid/data/mechanism")


def nbucket(n):
    b = np.full(n.shape, 6, dtype=np.int8)
    for lim, k in ((50, 5), (25, 4), (12, 3), (6, 2), (4, 1), (2, 0)):
        b[n <= lim] = k
    b[n < 0] = 7
    return b


NAMES = {0: "1-2", 1: "3-4", 2: "5-6", 3: "7-12", 4: "13-25", 5: "26-50", 6: "51+", 7: "N없음"}


def main():
    p = np.load(os.path.join(MECH, "plist.npz"))
    b = np.load(os.path.join(MECH, "bids.npz"))
    common, ip, ib = np.intersect1d(p["bid_id"], b["bid_id"], return_indices=True)
    rate, chosen = p["rate"][ip], p["chosen"][ip]
    N = p["bid_cnt"][ip]
    m15 = rate.mean(axis=1)
    R = (rate * chosen).sum(axis=1) / 4.0
    D = R - m15
    srt = np.sort(rate, axis=1)
    Rmax, Rmin = srt[:, 11:].mean(axis=1), srt[:, :4].mean(axis=1)
    M_all = b["xmax"][ib]                 # 철회 포함 (수정본)
    M_nw = b["xmax_nonwd"][ib]            # 철회 제외 (수정 전과 같은 값)
    n = len(common)

    print("=" * 88)
    print("① 🔴 corr(M, R) — M 이 R 을 지나가는가")
    print("=" * 88)
    print("  투찰은 R 추첨 전에 정해진다. 올바른 M 은 R 과 거의 독립이어야 한다.")
    for tag, M in (("M = xmax (철회 포함)", M_all), ("M = xmax (철회 제외)", M_nw)):
        ok = np.isfinite(M)
        pr = sps.pearsonr(M[ok], R[ok])
        sr = sps.spearmanr(M[ok], R[ok])
        prd = sps.pearsonr(M[ok], D[ok])
        prm = sps.pearsonr(M[ok], m15[ok])
        print("  %-22s n=%d" % (tag, ok.sum()))
        print("     corr(M, R)      Pearson %+.5f (p=%.3g)   Spearman %+.5f (p=%.3g)" % (
            pr[0], pr[1], sr[0], sr[1]))
        print("     corr(M, D)      Pearson %+.5f (p=%.3g)   ← 직접 오염 지표" % (prd[0], prd[1]))
        print("     corr(M, mean r) Pearson %+.5f (p=%.3g)   ← 대조: 이것도 0 이어야 한다" % (
            prm[0], prm[1]))
    print()
    print("  ⚠ 눈금: '낙찰자의 x' 를 M 으로 쓰면 (=R 의 함수) stats-expert 시뮬에서 +148.8 bp 가 나온다.")

    print()
    print("=" * 88)
    print("② 안전 부분집합 — 수정된 M 으로 다시. N 구간별")
    print("=" * 88)
    nb = nbucket(N)
    for tag, M in (("철회 포함(현행)", M_all), ("철회 제외(수정 전)", M_nw)):
        safe = np.isfinite(M) & (M >= Rmax)
        v = (rate.var(axis=1) / 4.0) * (11.0 / 14.0)
        print("  [%s]  안전 %d (%.1f%%)   mean(D) %+.4f bp   z %+.2f" % (
            tag, safe.sum(), 100 * safe.mean(), D[safe].mean() * 1e4,
            D[safe].sum() / np.sqrt(v[safe].sum())))
        for k in sorted(NAMES):
            s = safe & (nb == k)
            if s.sum() < 300:
                continue
            print("     N=%-7s n=%7d   %+8.4f bp   z %+7.2f" % (
                NAMES[k], s.sum(), D[s].mean() * 1e4, D[s].sum() / np.sqrt(v[s].sum())))
        print()

    print("=" * 88)
    print("③ Spearman(슬롯번호, 가격) — 안전/비안전. ml-expert 재현 (수정된 M)")
    print("=" * 88)
    seq = np.arange(1, 16)
    rk = np.argsort(np.argsort(rate, axis=1), axis=1) + 1
    rho = 1 - 6 * ((rk - seq) ** 2).sum(axis=1) / (15 * 224)
    safe = np.isfinite(M_all) & (M_all >= Rmax)
    for tag, s in (("전체", np.ones(n, bool)), ("안전 부분집합", safe), ("나머지", ~safe)):
        r = rho[s]
        print("  %-14s n=%7d   rho %+.6f   SE %.6f   z %+7.2f   D %+8.4f bp" % (
            tag, s.sum(), r.mean(), r.std(ddof=1) / np.sqrt(len(r)),
            r.mean() / (r.std(ddof=1) / np.sqrt(len(r))), D[s].mean() * 1e4))

    print()
    print("=" * 88)
    print("④ 낙찰 조건 항등식 (검정 조건은 자기 항등식을 같이 찍는다)")
    print("=" * 88)
    for tag, M in (("철회 포함", M_all), ("철회 제외", M_nw)):
        ok = np.isfinite(M)
        print("  [%s] M ≥ R  %8.4f%%   M < Rmin %8.4f%%   (100%% / 0%% 여야 한다)" % (
            tag, 100 * (M[ok] >= R[ok] - 1e-12).mean(), 100 * (M[ok] < Rmin[ok]).mean()))

    print()
    print("=" * 88)
    print("⑤ 동점 정의를 하나로 — 좌석마다 48.2% / 68.68% / 45.48% 로 달랐다")
    print("=" * 88)
    v_all = b["votes_all"][ib].astype(np.int32)
    nz = (v_all > 0).sum(axis=1)
    s = -np.sort(-v_all, axis=1)
    s4, s5 = s[:, 3], s[:, 4]
    above = (v_all > s4[:, None]).sum(axis=1)
    equal = (v_all == s4[:, None]).sum(axis=1)
    print("  정의 A  4위득표 == 5위득표                        %8.3f%%" % (100 * (s4 == s5).mean()))
    print("  정의 B  경계에 걸린 슬롯이 남은 자리보다 많다      %8.3f%%" % (
        100 * (equal > (4 - above)).mean()))
    print("     (= 서버가 실제로 골라야 하는 회차. 이게 옳은 정의다)")
    print("  정의 C  득표 슬롯 < 4 (채움 필요)                  %8.3f%%" % (100 * (nz < 4).mean()))
    print("  정의 D  B 또는 C (서버 규칙이 어떻게든 개입)        %8.3f%%" % (
        100 * ((equal > (4 - above)) | (nz < 4)).mean()))


if __name__ == "__main__":
    main()
