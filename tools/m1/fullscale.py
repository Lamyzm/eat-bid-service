# -*- coding: utf-8 -*-
"""모듈 책임: 전수 규모 대결 — 모든 투찰자를 **한 명씩** 갈아끼운다.

🔴 아버지 하나(투찰 3,926 · 표본 외 낙찰 14)로는 원래 판정이 안 섰다.
   사장 결정("낙찰만 되면 마진은 걱정 마라")으로 가격 맞추기가 빠지면서
   평가가 산술로 돌아왔고, 아버지에 묶일 이유가 없어졌다.

⚠ 한 회차에서 여러 명을 동시에 갈지 않는다 — 서로 부딪힌다. 한 번에 한 명.
⚠ `M4` 는 x 격자 86점 × GBDT 라 전수 10.5M 이 계산상 불가. **표본**을 쓰고 n 을 적는다.
"""
from __future__ import annotations

import numpy as np
from scipy import stats

import fx_kernel as K
import headtohead as HH
import m4_gbdt as M4

N_EVAL = 400000

_valid = K.x >= K.R[K.aid]
_big = np.where(_valid, K.x, np.inf)
_o = np.lexsort((_big, K.aid))
_xs, _as = _big[_o], K.aid[_o]
_f = np.ones(len(_xs), bool)
_f[1:] = _as[1:] != _as[:-1]
M1_ = np.full(len(K.nbid), np.inf)
M1_[_as[_f]] = _xs[_f]
_s2 = np.zeros(len(_xs), bool)
_s2[1:] = _f[:-1] & (_as[1:] == _as[:-1])
M2_ = np.full(len(K.nbid), np.inf)
M2_[_as[_s2]] = _xs[_s2]


def m_excl(idx):
    ai = K.aid[idx]
    ismin = _valid[idx] & (K.x[idx] <= M1_[ai])
    return np.where(ismin, M2_[ai], M1_[ai])


def report(idx, gbdt, label):
    ai = K.aid[idx]
    xi, Ra = K.x[idx], K.R[ai]
    n, a2 = K.nbid[ai], K.ALPHA2[ai].astype(int)
    act = K.ACT_ALL[idx]
    me = m_excl(idx)
    out = {}
    for nm, xx in (('M1', HH.decide(n, a2, 1.0)), ('M4', M4.decide(gbdt, idx))):
        w = (xx >= Ra) & (xx <= me)
        b = int((w & (act == 0)).sum())
        c = int(((~w) & (act == 1)).sum())
        p = stats.binomtest(b, b + c, 0.5).pvalue if b + c else np.nan
        out[nm] = (w, w.mean(), b, c, p, xx[w].mean() if w.any() else np.nan)
    hw = xi[act > 0].mean()
    print('  %-14s n=%7d · 사람 %5.3f%% · 제비 %5.3f%%'
          % (label, len(idx), 100 * act.mean(), 100 * (1.0 / n).mean()))
    for nm in ('M1', 'M4'):
        _, r, b, c, p, mx = out[nm]
        print('    %-3s %5.3f%%  b=%6d c=%6d 불일치 %6d  p=%.2e  낙찰x %+.2f%%'
              % (nm, 100 * r, b, c, b + c, p, 100 * (mx / hw - 1)))
    return out
