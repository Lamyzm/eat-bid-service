# -*- coding: utf-8 -*-
"""후보 6 — 회차 내 상관.  ICC_raw vs ICC_resid, 그리고 **천장**.

team-lead 설계 ③: 회차 내 상관이 관측 가능한 회차 공변량(기관·품목·지역)에서
오면 그건 "상관"이 아니라 **빠진 층**이다. 두 번 잰다.

🔴 그리고 추정 문제와 축의 존재를 분리한다:
    기관으로 민 위치이동이 나빠졌다 ≠ 회차 수준 축이 없다
    ⟹ **오라클**을 넣는다. 그 회차 *다른 투찰자들*의 실제 중앙값을 안다고 치고 민다.
       오라클도 개선을 못 하면 축 자체가 없는 것이다 (추정 실패가 아니라)
       오라클이 크게 개선하면 축은 있고 기관이 그 축을 못 잡는 것이다

⚠ 오라클은 누출이다. 상한을 재는 용도로만 쓴다. 제품에 못 쓴다.
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K
import inst_fx as I

H = 0.02
NB = np.maximum(K.nbid, 1)
BAND = I.BAND
aid = K.aid

# --- 회차 내 / 회차 간 분산 분해 (대역 내 투찰, m(N) 제거 후) ---------------------
r = K.x - I.mN[aid]                       # 투찰별 잔차
ok = BAND & (K.TUNE[aid])
ra, rr = aid[ok], r[ok]
cnt = np.bincount(ra, minlength=len(NB)).astype(float)
s1 = np.bincount(ra, weights=rr, minlength=len(NB))
mA = np.where(cnt > 0, s1 / np.maximum(cnt, 1), 0.0)
s2 = np.bincount(ra, weights=(rr - mA[ra]) ** 2, minlength=len(NB))

# 기관 잔차화 — 🔴 학습기에서 추정한 기관 평균을 TUNE 에 적용한다 (표본 내 흡수 방지)
gm = np.where(I._m > 0, I._s / np.maximum(I._m, 1), 0.0)[I.IIDX]


def icc(sel, center):
    """한 방향 임의효과 ANOVA.  center 는 회차별로 빼는 값."""
    q = sel & (cnt >= 2)
    n_a, m_a = cnt[q], mA[q] - center[q]
    M, T = len(n_a), n_a.sum()
    if M < 30:
        return (np.nan,) * 3
    gr = (n_a * m_a).sum() / T
    MSB = (n_a * (m_a - gr) ** 2).sum() / (M - 1)
    MSW = s2[q].sum() / max(T - M, 1)
    n0 = (T - (n_a ** 2).sum() / T) / (M - 1)
    vb = max((MSB - MSW) / n0, 0.0)
    return vb / (vb + MSW), np.sqrt(vb), np.sqrt(MSW)


if __name__ == '__main__':
    print('=== ① 회차 내 상관 ICC — 원본 vs 기관·품목·지역 잔차화 ===')
    print('  (TUNE · 대역 내 투찰 · m(N) 제거 후 · 기관 평균은 학습기에서 추정)')
    zero = np.zeros(len(NB))
    print('%-10s %7s %9s %9s %9s %9s %9s' %
          ('N', '회차', 'ICC_raw', 'sd_between', 'ICC_resid', 'sd_between', 'sd_within'))
    for lo, hi in K.BANDS:
        sel = K.TUNE & (K.nbid >= lo) & (K.nbid <= hi)
        a = icc(sel, zero)
        b = icc(sel, gm)
        print('%-10s %7d %9.3f %9.5f %9.3f %9.5f %9.5f'
              % ('%d-%d' % (lo, hi), sel.sum(), a[0], a[1], b[0], b[1], b[2]))
    print('\n  ⟹ ICC_resid 가 무너지면 원인은 **빠진 층**. 살아남으면 진짜 회차 내 의존.')

    # --- ② 천장: 회차의 실제 수준을 안다고 치고 민다 (leave-one-out) -------------
    print('\n=== ② 천장 — 오라클 위치이동 (그 회차 *다른* 투찰자들의 실제 중앙값) ===')
    XI, AI, NT, ACT = K.XI, K.AI, K.NT, K.ACT
    ssum = np.bincount(ra, weights=rr, minlength=len(NB))
    scnt = cnt.copy()
    inb = BAND[K._sel]
    loo = np.where(inb, ssum[AI] - r[K._sel], ssum[AI])
    lon = np.where(inb, scnt[AI] - 1, scnt[AI])
    ORC = np.where(lon > 0, loo / np.maximum(lon, 1), 0.0)     # 자기 자신 제외 평균 잔차
    print('  sd(오라클 δ) %.5f  (기관 δ κ=1 은 %.5f · sd(R)=0.00760)'
          % (ORC.std(), I.delta(1)[I.IIDX[AI]].std()))

    def run(dl, lab):
        out = np.zeros(len(XI))
        for n, q in K.GRP.items():
            out[q] = I.pwin_d(XI[q], I._F[n], NT[q], dl[q])
        return K.report(out, lab)

    print('\n대역 %s' % ' '.join('%d-%d' % b for b in K.BANDS))
    base = run(np.zeros(len(XI)), '기준선 (이동 없음)')
    for sc in (0.25, 0.5, 1.0):
        run(sc * ORC, '오라클 ×%.2f' % sc)
    print('\n  🔴 오라클도 저N Brier %.6f 를 못 이기면 회차 수준 축은 없다.' % base[1])


def _within_cdf():
    """회차 내 편차 (x − r̄_a) 의 N 별 경험 CDF.  🔴 풀링 F_X 는 회차 간 성분만큼 **너무 넓다**."""
    dev = K.x - I.mN[aid] - mA[aid]
    tb = K.TRAIN[aid] & BAND
    emp, cn = {}, {}
    for n in np.unique(K.nbid[K.TRAIN]):
        q = tb & (K.nbid[aid] == n)
        if q.sum() < 50:
            continue
        v = np.sort(dev[q] + I.mN[aid][q])          # 다시 m(N) 을 더해 x 축으로
        emp[int(n)] = np.searchsorted(v, K.XGRID, side='right') / len(v)
        cn[int(n)] = float(q.sum())
    ns = np.array(sorted(emp), float)
    return ns, np.stack([emp[int(n)] for n in ns]), np.array([cn[int(n)] for n in ns])


def within_at(nv, ns, em, cn, h=H):
    d = np.abs(np.log(np.asarray(nv, float))[:, None] - np.log(ns)[None, :])
    w = cn[None, :] * np.exp(-d / h)
    w /= w.sum(1, keepdims=True)
    return w @ em


if __name__ == '__main__':
    print('\n=== ③ 오라클 위치 + **회차 내** 폭 — 두 오차가 상쇄되고 있었는지 ===')
    ns, em, cn = _within_cdf()
    FW = {int(n): within_at([n], ns, em, cn)[0] for n in np.unique(K.NT)}

    def run2(dl, lab, F):
        out = np.zeros(len(K.XI))
        for n, q in K.GRP.items():
            out[q] = I.pwin_d(K.XI[q], F[n], K.NT[q], dl[q])
        return K.report(out, lab)

    z = np.zeros(len(K.XI))
    print('대역 %s' % ' '.join('%d-%d' % b for b in K.BANDS))
    run2(z, '풀링 F_X · 이동 없음', I._F)
    run2(z, '회차내 F_X · 이동 없음', FW)
    for sc in (0.5, 1.0):
        run2(sc * ORC, '회차내 F_X · 오라클 ×%.2f' % sc, FW)
