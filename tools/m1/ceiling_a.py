# -*- coding: utf-8 -*-
"""🔴 `(a)` 정보 천장 — `P(승_i | x 전부)`.  `F_X` 를 **안 쓴다**. `f_R` 만 쓴다.

team-lead 지시: 이걸 재면 남은 가설 공간이 두 조각으로 갈린다.
```
(a) 가 보정된다   →  f_R 도 승률 규칙도 맞다  ⟹  잔차는 전부 F_X 안에 있다 (후보 2 유력)
(a) 도 틀린다     →  F_X 가 아니다.  f_R 이거나 규칙 자체다  ⟹  후보 2·6 전부 헛다리
```

닫힌 형태다. 새 모형 0:
```
낙찰_i  ⟺  x_i ≥ R  ∧  ¬∃j≠i: R ≤ x_j < x_i
        ⟺  m_i < R ≤ x_i         m_i = max{x_j : j≠i, x_j < x_i}  (없으면 −∞)

P(승_i | x 전부) = F_R(x_i) − F_R(m_i)
```

🔴 **그리고 이게 곧 예산 항등식이다** (규율 24). 서로 다른 x 값 v_1<…<v_K 에 대해
`Σ_i P(승_i)` 가 망원경처럼 접혀 `F_R(x_max)` 가 된다. 단언으로 건다.

⚠ `R` 은 재생성된 `asof.npz`(정의 B) 에서. `R_suspect` 91건 제외.
⚠ 동점은 서로를 막지 않는다(`<` 이므로). 실제 동점 처리와 다를 수 있어 비율을 같이 낸다.
⚠ `TUNE` 에서만.
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K
from fr import FR

_FR = FR(n=500000, seed=3, nbin=2001)           # 천장이므로 R 격자를 촘촘히


def _cdf(a, v):
    return np.interp(v, _FR.edges[a], _FR.cdf[a], left=0.0, right=1.0)


def compute(mask):
    """(a) 를 회차 mask 에 대해. 반환: 투찰별 p, 실제 낙찰, aid, N."""
    sel = mask[K.aid]
    idx = np.flatnonzero(sel)
    xi, ai = K.x[idx], K.aid[idx]
    # 회차별 정렬 → m_i (자기보다 작은 것 중 최대)
    o = np.lexsort((xi, ai))
    xs, as_ = xi[o], ai[o]
    first = np.ones(len(xs), bool)
    first[1:] = as_[1:] != as_[:-1]
    # 🔴 동점은 서로를 막지 않는다(`<` 이므로). 같은 값의 **런 시작**까지 거슬러 올라간다.
    #    런 시작 s 에 대해 m = xs[s−1] (회차 안에 더 작은 게 있으면), 없으면 −∞
    n_ = len(xs)
    newrun = first.copy()
    newrun[1:] |= xs[1:] != xs[:-1]
    rs = np.maximum.accumulate(np.where(newrun, np.arange(n_), -1))
    m = np.where(first[rs], -np.inf, xs[np.maximum(rs - 1, 0)])
    # 🔴 그런데 동점자 중 낙찰자는 **한 명**이다 (슬롯·시각으로 갈린다).
    #    k 명이 같은 값이면 그 구간 확률을 k 로 나눈다. 안 나누면 예산이 k 배가 된다 —
    #    첫 실행에서 예산 단언이 회차 8,818 건(25%)에서 터졌고 원인이 이거였다.
    #    ⚠ 어느 동점자가 이기는지는 모른다. 대칭 배분이다. 회차 합은 정확해진다
    runlen = np.diff(np.append(np.flatnonzero(newrun), n_))
    K_ = np.repeat(runlen, runlen).astype(float)
    a2 = K.ALPHA2[as_]
    p = np.empty(len(xs))
    for al, q in ((0.03, ~a2), (0.02, a2)):
        if q.any():
            p[q] = _cdf(al, xs[q]) - _cdf(al, m[q])
    p = np.clip(p, 0, 1) / K_
    # 실제 낙찰 (실현 R 로)
    v = K.x >= K.R[K.aid]
    xv = np.where(v, K.x, 1e9)
    oo = np.lexsort((xv, K.aid))
    ff = np.ones(len(K.x), bool)
    ff[1:] = K.aid[oo][1:] != K.aid[oo][:-1]
    w = np.zeros(len(K.x), bool)
    wi = oo[ff]
    w[wi] = v[wi]
    return p, w[idx][o].astype(float), as_, K.nbid[as_], xs, K_


if __name__ == '__main__':
    mask = K.TUNE
    p, act, aid, nt, xs, K_ = compute(mask)
    print('동점 투찰 비율 %.4f · 동점이 있는 회차 %.4f'
          % ((K_ > 1).mean(),
             (np.bincount(aid, weights=(K_ > 1).astype(float),
                          minlength=len(K.R))[mask] > 0).mean()))
    print('TUNE 회차 %d · 투찰 %d · 실제 낙찰률 %.5f' % (mask.sum(), len(p), act.mean()))

    # --- 🔴 예산 항등식 단언 (규율 24) ------------------------------------------
    S = np.bincount(aid, weights=p, minlength=len(K.R))[mask]
    xmax = np.maximum.reduceat(xs, np.concatenate(
        [[0], np.flatnonzero(np.diff(aid) != 0) + 1]))
    a2 = K.ALPHA2[np.unique(aid)]
    FRx = np.where(a2, _cdf(0.02, xmax), _cdf(0.03, xmax))
    err = np.abs(S - FRx) / np.maximum(FRx, 1e-12)
    print('\n🔴 예산 항등식  Σ_i P(승_i) = F_R(x_max)')
    print('   상대오차  중앙 %.2e · p99 %.2e · max %.2e · >1e−6 인 회차 %d'
          % (np.median(err), np.percentile(err, 99), err.max(), (err > 1e-6).sum()))
    print('   E[F_R(x_max)] = %.5f   ⟹ 낙찰자 있는 코퍼스에서 올바른 모형은 %.1f%% 로 보인다'
          % (FRx.mean(), 100 * (FRx.mean() / 1.0 - 1)))
    print('   실제로 낙찰자가 있는 회차 비율 %.5f'
          % (np.bincount(aid, weights=act, minlength=len(K.R))[mask] > 0).mean())

    # --- 층별 보정 --------------------------------------------------------------
    print('\n=== (a) 층별 미보정 — F_X 를 안 쓴 천장 ===')
    print('%-10s %10s %9s %10s %10s %12s'
          % ('N', '투찰', '회차', '실제', '예측', '미보정'))
    for lo, hi in K.BANDS:
        q = (nt >= lo) & (nt <= hi)
        if q.sum() < 500:
            continue
        a_, pp = act[q].mean(), p[q].mean()
        se = K.cluster_se(p[q] - act[q], aid[q])
        print('%-10s %10d %9d %10.5f %10.5f  %+6.1f ± %.1f%%'
              % ('%d-%d' % (lo, hi), q.sum(), len(np.unique(aid[q])), a_, pp,
                 100 * (pp - a_) / a_, 100 * se / a_))
    se = K.cluster_se(p - act, aid)
    print('%-10s %10d %9d %10.5f %10.5f  %+6.1f ± %.1f%%'
          % ('전체', len(p), mask.sum(), act.mean(), p.mean(),
             100 * (p.mean() / act.mean() - 1), 100 * se / act.mean()))
    print('\n  🔴 −4.3%% 근처면 f_R·규칙 정상 (후보 5 의 007 조건부 때문에 그렇게 보인다).')
    print('     그보다 크게 벗어나면 f_R 이거나 승률 규칙이 틀린 것이다.')
