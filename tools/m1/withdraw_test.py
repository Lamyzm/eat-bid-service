# -*- coding: utf-8 -*-
"""철회 포함 `N_pool` 로 바꾸면 저`N` 과대예측이 줄어드나 — 사전 등록 검정.

team-lead 판정: `N` 은 개찰 시점 풀 = `BID_CNT` = 철회 포함.
**사전 등록: `N=3-4` 의 과대예측이 007 바닥 쪽으로 내려가야 한다.**

🔴 판별 결과 — `xcap` 은 **철회 제외**다:
```
두 정의가 갈리는 13,770 회차에서 xcap 의 회차 최대가 100% xmax_nonwd 와 일치
plist.bid_cnt == bids.nbid + nwithdraw  (98.52%)   ⟹ BID_CNT 는 포함, 우리 건 제외
```
⚠ 그래서 **지수는 고칠 수 있지만 나머지는 못 고친다:**
```
✅ 지수        풀 수를 알고 있다 (bids.nbid + nwithdraw)
✅ F_X 층      풀 수로 색인할 수 있다
❌ F_X 표본    철회자의 x 가 자료에 없다.  관측된 비철회 투찰로만 추정된다
❌ 경쟁자 벡터  (a) 천장이 철회자를 빼고 계산된다
❌ ACT 라벨    낙찰자가 철회한 7.5% 회차에서 다음 사람에게 낙찰이 붙는다
```
🔴 **⟹ 완전한 수정은 철회 포함 `xcap` 재생성이 필요하다. 여기서는 지수·층만 바꾼다.**

⚠ 세 조합을 **각각의 경험 CDF 족으로** 비교한다 — 층을 바꾸면 `F_X` 자체를 다시 만들어야 한다.
  (첫 시도에서 `N_pool` 로 만든 CDF 를 `N_obs` 로 조회해 무효한 표를 냈다)
"""
from __future__ import annotations

import numpy as np

import ceiling_a as C
import fx_kernel as K

NOBS, NPOOL = K.NOBS, K.nbid          # fx_kernel 에서 nbid 는 이미 풀 수다
XG = K.XGRID


def build(keyN):
    """층 지표 keyN(회차별)로 경험 CDF 족을 만든다. 학습기 · 관측 투찰만."""
    tb = K.TRAIN[K.aid]
    kb = keyN[K.aid]
    emp, cn = {}, {}
    for n in np.unique(keyN[K.TRAIN]):
        q = tb & (kb == n)
        c = int(q.sum())
        if c < 50:
            continue
        v = np.sort(K.x[q])
        emp[int(n)] = np.searchsorted(v, XG, side='right') / len(v)
        cn[int(n)] = float(c)
    ns = np.array(sorted(emp), float)
    return ns, np.stack([emp[int(n)] for n in ns]), np.array([cn[int(n)] for n in ns])


def fx_at(nv, fam, h=0.02):
    ns, em, cn = fam
    d = np.abs(np.log(np.asarray(nv, float))[:, None] - np.log(ns)[None, :])
    w = cn[None, :] * np.exp(-d / h)
    w /= w.sum(1, keepdims=True)
    return w @ em


if __name__ == '__main__':
    sel = K.TUNE[K.aid]
    XI, AI = K.x[sel], K.aid[sel]
    A2 = K.ALPHA2[AI]
    v = K.x >= K.R[K.aid]
    xv = np.where(v, K.x, 1e9)
    o = np.lexsort((xv, K.aid))
    f = np.ones(len(K.x), bool)
    f[1:] = K.aid[o][1:] != K.aid[o][:-1]
    w_ = np.zeros(len(K.x), bool)
    wi = o[f]
    w_[wi] = v[wi]
    ACT = w_[sel].astype(float)
    BAND = NOBS[AI]                       # 🔴 대역은 **관측 N** 으로 고정. 구성이 안 바뀐다

    FAM = {'obs': build(NOBS), 'pool': build(NPOOL)}
    print('CDF 족  obs N 격자 %d · pool N 격자 %d'
          % (len(FAM['obs'][0]), len(FAM['pool'][0])))

    def run(skey, ekey, fam):
        sN = skey[AI]
        out = np.zeros(len(XI))
        for n in np.unique(sN):
            q = np.flatnonzero(sN == n)
            F = fx_at([n], FAM[fam])[0]
            out[q] = K.pwin_v(XI[q], F, ekey[AI][q], a2=A2[q])
        return out

    combos = [(NOBS, NOBS, 'obs', '구: 층·지수 모두 관측 N'),
              (NOBS, NPOOL, 'obs', '지수만 N_pool'),
              (NPOOL, NPOOL, 'pool', '🔴 층·지수 모두 N_pool')]
    P = [(lab, run(s, e, fm)) for s, e, fm, lab in combos]

    pa, act, aid_a, _, _, _ = C.compute(K.TUNE)
    NOBS_a = NOBS[aid_a]
    print('\n=== 사전 등록 검정 — 대역은 관측 N 고정 (구성 불변) ===')
    print('%-9s %8s %10s %11s %11s %13s'
          % ('관측 N', '회차', '007 바닥', '구', '지수만', '층+지수'))
    for lo, hi in [(3, 4), (5, 9), (10, 29), (30, 59), (60, 99), (100, 10 ** 9)]:
        q = (BAND >= lo) & (BAND <= hi)
        qa = (NOBS_a >= lo) & (NOBS_a <= hi)
        if q.sum() < 500:
            continue
        b = 100 * (pa[qa].mean() / act[qa].mean() - 1)
        g = [100 * (p[q].mean() / ACT[q].mean() - 1) - b for _, p in P]
        se = 100 * K.cluster_se(P[2][1][q] - ACT[q], AI[q]) / ACT[q].mean()
        print('%-9s %8d %9.2f%% %+10.2f %+10.2f %+9.2f±%.2f'
              % ('%d-%d' % (lo, min(hi, 364)), len(np.unique(AI[q])), b, *g, se))
    print('\n  사전 등록: 저N 과대예측이 007 바닥 쪽으로 내려가야 한다.')
    print('  ⚠ 지수·층만 고친 것이다. F_X 표본·경쟁자 벡터·ACT 라벨은 여전히 철회 제외다.')


def predict(skey, ekey, fam, XI, AI, A2):
    """모듈 밖에서 쓸 수 있는 예측기. skey=층 지표, ekey=지수 지표, fam='obs'|'pool'."""
    sN = skey[AI]
    out = np.zeros(len(XI))
    for n in np.unique(sN):
        q = np.flatnonzero(sN == n)
        F = fx_at([n], build.__wrapped__ if False else _FAM[fam])[0]
        out[q] = K.pwin_v(XI[q], F, ekey[AI][q], a2=A2[q])
    return out


_FAM = {'obs': build(NOBS), 'pool': build(NPOOL)}
