# -*- coding: utf-8 -*-
"""3번(개정) — F_X 를 **정확한 N** 으로 조건부화. 상한 없음 + 목적함수 저N.

두 가지를 고쳤다:

🔴 ① `N ≥ 60` 상한 제거.  전체 발견이 "버킷 경계가 인공물을 만든다"인데
     내가 60 이라는 새 경계를 넣었고 기울기 보정 편차 −9.6 %p 가 나왔다.
     ⟹ 커널을 **연속 함수**로 바꾼다. F_X(·|n) 을 임의의 n 에서 계산한다.
       표본이 얇은 N 은 자기 CDF 를 안 만들고 이웃에서 빌린다 — 경계가 없다.

🔴 ② h 스윕의 목적함수를 저N(N<30) 으로.  (team-lead 지시)
     전역 Brier 는 98% 가 고N 에서 오고 고N 은 이미 −0.5% 로 멀쩡하다.
     ⟹ 안 고쳐도 되는 구간이 h 를 정하면 "개선 없음"이 목적함수의 산물일 수 있다.
     두 목적함수를 **같은 표에** 낸다. 갈리면 그 자체가 결과다.

⚠ 모든 수치에 표본 수와 군집 SE 를 같이 낸다 (회차 군집 — 회차당 낙찰자가 정확히 1명).
"""
from __future__ import annotations

import numpy as np

from fr import FR

XC = np.load(r'F:/Project/eat-bid/data/mechanism/xcap.npz', allow_pickle=True)
AS = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)

x, cnt, R, nbid = (XC['x'].astype(np.float64), XC['off'], XC['R'],
                   XC['nbid'].astype(int))
bi = {b: i for i, b in enumerate(AS['bid_id'])}
k = np.array([bi.get(b, -1) for b in XC['bid_id']])
OK_A, KA = k >= 0, np.clip(k, 0, None)
ym = np.where(OK_A, AS['ym'][KA], -1).astype(int)
hi_ = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([hi_.get(b, '') for b in XC['bid_id']])

aid = np.repeat(np.arange(len(R)), cnt)
TRAIN = (ym <= 202512) & (nbid >= 3)
TUNE = (split == 'TUNE') & (nbid >= 3)

XGRID = np.linspace(0.94, 1.10, 1601)

# --- 정확한 N 별 경험 CDF (학습 기간).  🔴 상한 없음 -----------------------------
_tb = TRAIN[aid]
_emp, _cn = {}, {}
for n in np.unique(nbid[TRAIN]):
    q = _tb & (nbid[aid] == n)
    c = int(q.sum())
    if c < 50:
        continue
    v = np.sort(x[q])
    _emp[int(n)] = np.searchsorted(v, XGRID, side='right') / len(v)
    _cn[int(n)] = c
NS = np.array(sorted(_emp), float)
EMP = np.stack([_emp[int(n)] for n in NS])
CN = np.array([_cn[int(n)] for n in NS], float)
LOGNS = np.log(NS)


def Fx_at(nvals, h):
    """F_X(·|n) 을 **임의의** n 에서. 경계 없음.  w ∝ n_N' · exp(−|log n − log N'|/h)"""
    d = np.abs(np.log(np.asarray(nvals, float))[:, None] - LOGNS[None, :])
    w = CN[None, :] * np.exp(-d / max(h, 1e-6))
    w /= w.sum(1, keepdims=True)
    return w @ EMP


_FR = FR(n=200000, seed=2, nbin=201)
_MID = _FR.mid[0.03]
_W = _FR.pdf[0.03] * np.diff(_FR.edges[0.03])
# 🔴 α 는 회차마다 다르다 (fr.alpha_of: 하한율 88 & 기초금액<2천만 → 0.02, 나머지 0.03).
#    α=0.02 회차가 2.96% 다.  회차별 α 로 R 분포를 골라 쓴다.
_MID2 = _FR.mid[0.02]
_W2 = _FR.pdf[0.02] * np.diff(_FR.edges[0.02])
_af = np.where(OK_A, AS['floor'][KA], np.nan)
_ab = np.where(OK_A, AS['bgng'][KA], np.nan)
ALPHA2 = (_af == 88) & (_ab < 2e7)          # 회차별: True 면 α=0.02

# --- 평가 대상 (TUNE) ---------------------------------------------------------
_sel = TUNE[aid]
_rng = np.random.default_rng(0)
_idx = np.flatnonzero(_sel)
if len(_idx) > 250000:
    _idx = _rng.choice(_idx, 250000, replace=False)
_sel = np.zeros(len(x), bool)
_sel[_idx] = True
XI, AI = x[_sel], aid[_sel]
NT = nbid[AI]                       # 🔴 지수는 언제나 실제 N

_valid = x >= R[aid]
_xv = np.where(_valid, x, 1e9)
_o = np.lexsort((_xv, aid))
_f = np.ones(len(x), bool)
_f[1:] = aid[_o][1:] != aid[_o][:-1]
_win = np.zeros(len(x), bool)
_wi = _o[_f]
_win[_wi] = _valid[_wi]
ACT = _win[_sel].astype(float)

UNQ = np.unique(NT)
GRP = {int(n): np.flatnonzero(NT == n) for n in UNQ}


def pwin_v(xv, Fx, nvec, chunk=4000, a2=None):
    """a2: 회차별 bool. True 면 α=0.02 의 R 분포를 쓴다. None 이면 전부 0.03."""
    out = np.empty(len(xv))
    Fr = np.interp(_MID, XGRID, Fx)
    Fr2 = np.interp(_MID2, XGRID, Fx)
    for a in range(0, len(xv), chunk):
        v = xv[a:a + chunk]
        nn = np.maximum(np.asarray(nvec[a:a + chunk], float) - 1, 0)[:, None]   # 🔴 지수는 경쟁자 수 = N−1
        for mid, wt, fr_, m in ((_MID, _W, Fr, None), (_MID2, _W2, Fr2, True)):
            if a2 is None:
                sub = slice(None) if m is None else None
                if sub is None:
                    continue
                idx = np.arange(len(v))
            else:
                s = a2[a:a + chunk]
                idx = np.flatnonzero(~s if m is None else s)
                if len(idx) == 0:
                    continue
            vv = v[idx]
            Fv = np.interp(vv, XGRID, Fx)[:, None]
            surv = np.clip(1 - Fv + fr_[None, :], 0, 1) ** nn[idx]
            out[a + idx] = (wt[None, :] * surv * (mid[None, :] <= vv[:, None])).sum(1)
    return out


def predict(h, use_alpha=True):
    F = Fx_at(UNQ, h)
    A2 = ALPHA2[AI] if use_alpha else None
    out = np.zeros(len(XI))
    for j, n in enumerate(UNQ):
        q = GRP[int(n)]
        out[q] = pwin_v(XI[q], F[j], NT[q], a2=None if A2 is None else A2[q])
    return out


def cluster_se(d, a):
    """회차 군집 SE — 회차당 낙찰자가 정확히 1명이라 회차 내 상관이 강하다."""
    m = len(d)
    if m == 0:
        return np.nan
    D = d.mean()
    u, inv = np.unique(a, return_inverse=True)
    S = np.bincount(inv, weights=d - D)
    return float(np.sqrt((S ** 2).sum()) / m)


BANDS = [(3, 4), (5, 9), (10, 29), (30, 59), (60, 99), (100, 364)]


def report(p, label, quiet=False):
    rows = []
    for lo, hi2 in BANDS:
        q = (NT >= lo) & (NT <= hi2)
        if q.sum() < 500:
            rows.append((np.nan,) * 4)
            continue
        a = ACT[q].mean()
        d = p[q] - ACT[q]
        se = cluster_se(d, AI[q])
        rows.append((100 * d.mean() / a, 100 * se / a, int(q.sum()),
                     len(np.unique(AI[q]))))
    lo30 = NT < 30
    bg = float(np.mean((p - ACT) ** 2))
    bl = float(np.mean((p[lo30] - ACT[lo30]) ** 2))
    if not quiet:
        print('  %-20s Brier 전역 %.6f  저N %.6f | %s'
              % (label, bg, bl,
                 ' '.join('%6.1f±%.1f%%' % (r[0], r[1]) for r in rows)))
    return bg, bl, rows


if __name__ == '__main__':
    print('TUNE 회차 %d · 평가 투찰 %d · N 격자 %d (%d~%d, 최소표본 %d)'
          % (TUNE.sum(), len(XI), len(NS), NS[0], NS[-1], CN.min()))
    print('\n대역 %s' % ' '.join('%d-%d' % b for b in BANDS))
    print('=== h 스윕 — 목적함수 두 개를 같은 표에 ===')
    res = {}
    for h in (0.02, 0.03, 0.05, 0.08, 0.12, 0.20, 0.40, 0.80):
        res[h] = report(predict(h), 'h=%.2f' % h)
    hg = min(res, key=lambda h: res[h][0])
    hl = min(res, key=lambda h: res[h][1])
    print('\n  전역 Brier 최소 h=%.2f · 🔴 저N(N<30) Brier 최소 h=%.2f' % (hg, hl))
