# -*- coding: utf-8 -*-
"""모듈 책임: 재구축의 세 변경을 **하나씩** 켠다. 대역은 `N_pool` 로 **고정**한다.

⚠ 이 세션에서 대역 정의가 다른 표를 세 번 비교했다. 그때마다 회차가 대역을 옮겨
   비교가 오염됐다. 여기서는 모든 변형이 **같은 대역·같은 회차**를 쓴다.

세 변경:
```
① ACT      규칙 유도 min{x≥R}      →  is_recorded_winner
② F_X 표본  생존자 투찰만            →  전 투찰 (철회 포함)
③ 지수      N_obs (생존자 수)        →  N_pool (BID_CNT)
```
`007` 바닥도 각 `ACT` 정의마다 다시 계산한다 — 분모가 바뀌면 바닥도 바뀐다.
"""
from __future__ import annotations

import numpy as np

import ceiling_a as C
import fx_kernel as K

H = 0.02
XI, AI, NT, A2 = K.XI, K.AI, K.NT, K.ALPHA2[K.AI]
BAND = NT                                   # 🔴 대역은 언제나 N_pool. 고정
NOBS_B = K.NOBS[AI]

# --- ACT 두 정의 ---------------------------------------------------------------
ACT_REC = K.ACT
_v = K.x >= K.R[K.aid]
_xv = np.where(_v, K.x, 1e9)
_o = np.lexsort((_xv, K.aid))
_f = np.ones(len(K.x), bool)
_f[1:] = K.aid[_o][1:] != K.aid[_o][:-1]
_w = np.zeros(len(K.x), bool)
_wi = _o[_f]
_w[_wi] = _v[_wi]
ACT_RULE = _w[K.TUNE[K.aid]].astype(float)   # ⚠ 나이 의존. 비교용으로만 만든다


def emp(sample_all, keyN):
    """경험 CDF 족. sample_all=False 면 생존자 투찰만."""
    m = K.TRAIN[K.aid]
    if not sample_all:
        m = m & ~K._WD_DIAG
    kb = keyN[K.aid]
    e, c = {}, {}
    for n in np.unique(keyN[K.TRAIN]):
        q = m & (kb == n)
        if q.sum() < 50:
            continue
        v = np.sort(K.x[q])
        e[int(n)] = np.searchsorted(v, K.XGRID, side='right') / len(v)
        c[int(n)] = float(q.sum())
    ns = np.array(sorted(e), float)
    return ns, np.stack([e[int(n)] for n in ns]), np.array([c[int(n)] for n in ns])


def fx(nv, fam):
    ns, em, cn = fam
    d = np.abs(np.log(np.asarray(nv, float))[:, None] - np.log(ns)[None, :])
    w = cn[None, :] * np.exp(-d / H)
    w /= w.sum(1, keepdims=True)
    return w @ em


def run(fam, ekey, skey):
    sN = skey
    out = np.zeros(len(XI))
    for n in np.unique(sN):
        q = np.flatnonzero(sN == n)
        out[q] = K.pwin_v(XI[q], fx([n], fam)[0], ekey[q], a2=A2[q])
    return out


if __name__ == '__main__':
    pa, _, aid_a, _, _, _ = C.compute(K.TUNE)
    ordr = np.lexsort((K.x[K.TUNE[K.aid]], AI))
    PA = np.empty(len(XI))
    PA[ordr] = pa                            # (a) 천장을 원래 행 순서로

    FAM_SURV = emp(False, K.NOBS)
    FAM_ALL = emp(True, K.nbid)
    FAM_SURV_P = emp(False, K.nbid)

    variants = [
        ('구: 규칙ACT·생존F_X·N_obs', ACT_RULE, FAM_SURV, NOBS_B, NOBS_B),
        ('① ACT 만 기록으로', ACT_REC, FAM_SURV, NOBS_B, NOBS_B),
        ('①+③ 지수·층 N_pool', ACT_REC, FAM_SURV_P, NT, NT),
        ('①+③+② F_X 전 투찰 (정본)', ACT_REC, FAM_ALL, NT, NT),
    ]
    print('\n=== 하나씩 켠다.  대역 = N_pool 고정 ===')
    print('%-26s %9s %9s %9s %9s %9s %9s'
          % ('', '3-4', '5-9', '10-29', '30-59', '60-99', '100+'))
    for lab, act, fam, ek, sk in variants:
        p = run(fam, ek, sk)
        cells = []
        for lo, hi in K.BANDS:
            q = (BAND >= lo) & (BAND <= hi)
            if q.sum() < 500:
                cells.append('     —')
                continue
            b = 100 * (PA[q].mean() / act[q].mean() - 1)
            g = 100 * (p[q].mean() / act[q].mean() - 1) - b
            cells.append('%+6.2f' % g)
        tot = (100 * (p.mean() / act.mean() - 1)
               - 100 * (PA.mean() / act.mean() - 1))
        print('%-26s %s  | 전체 %+6.2f' % (lab, ' '.join(cells), tot))
    print('\n  ⚠ 값은 007 바닥 대비 격차 %p.  바닥은 ACT 정의마다 다시 계산했다.')
