# -*- coding: utf-8 -*-
"""회차 수준 r̄_a 가 **투찰 전에 관측되는 것**으로 얼마나 예측되나.

후보 6 의 결정적 질문은 "회차 내 상관이 있나"가 아니다 — 있다 (ICC 0.39 at N=3-4).
질문은 **그 상관을 낳는 회차 수준을 마감 전에 알 수 있나**다.

  알 수 있다  →  빠진 층이다.  F_X 에 넣으면 된다
  알 수 없다  →  축은 실재하지만 **관측 불가**다.  모형이 못 쓰는 정보다

오라클(다른 투찰자들의 실제 값)은 천장이 아니다 — 경쟁자의 실현값을 두 번 쓴다
(δ 로 한 번, F 에서 다시 한 번). 그래서 여기서는 오라클을 안 쓰고
**마감 전에 존재하는 공변량만** 쓴다.

⚠ 학습기(ym≤202512)에서 적합, TUNE 에서 평가. 봉인 미접촉.
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

import fx_kernel as K
import inst_fx as I

AS = K.AS
_ai = {b: i for i, b in enumerate(AS['bid_id'])}
_k = np.array([_ai.get(b, -1) for b in K.XC['bid_id']])
OK = _k >= 0
kk = np.clip(_k, 0, None)


def col(name, cast=float):
    v = AS[name][kk]
    return np.where(OK, v, np.nan).astype(cast) if cast is float else v


item = np.where(OK, AS['item'][kk], -1).astype(int)
sido = AS['sido'][kk]
_, sid = np.unique(np.where(OK, sido, ''), return_inverse=True)
floor = col('floor')
bgng = col('bgng')
alpha = col('alpha')
inst = I.IIDX
Nb = K.nbid

# 기관 효과는 **학습기에서 수축 추정**한 값을 특징으로 넣는다 (표본 내 흡수 방지)
gshr = I.delta(10)                       # κ=10 수축
X = np.column_stack([item, sid, floor, np.log(np.maximum(bgng, 1)), alpha,
                     np.log(np.maximum(Nb, 1)), gshr[inst], I._m[inst]])
Y = I.RBAR                               # 회차 잔차 중앙값 (m(N) 제거 후)

_ok = I._ok & OK & np.isfinite(X).all(1) & np.isfinite(Y)
TR = _ok & K.TRAIN
TE = _ok & K.TUNE
print('학습 %d 회차 · 평가 %d 회차 · 특징 %d' % (TR.sum(), TE.sum(), X.shape[1]))

m = HistGradientBoostingRegressor(max_iter=400, learning_rate=0.06,
                                  categorical_features=[0, 1], random_state=0)
m.fit(X[TR], Y[TR])
p = m.predict(X[TE])

BANDS = K.BANDS
print('\n%-10s %8s %10s %10s %10s' % ('N', '회차', 'sd(r̄_a)', 'sd(예측)', '설명 R²'))
for lo, hi in BANDS:
    q = TE & (Nb >= lo) & (Nb <= hi)
    if q.sum() < 200:
        continue
    y, pp = Y[q], m.predict(X[q])
    r2 = 1 - ((y - pp) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    print('%-10s %8d %10.5f %10.5f %10.3f'
          % ('%d-%d' % (lo, hi), q.sum(), y.std(), pp.std(), r2))
r2a = 1 - ((Y[TE] - p) ** 2).sum() / ((Y[TE] - Y[TE].mean()) ** 2).sum()
print('%-10s %8d %10.5f %10.5f %10.3f' % ('전체', TE.sum(), Y[TE].std(), p.std(), r2a))

print('\n  ⚠ sd(r̄_a) 는 회차 간 성분 σ_b 와 회차 내 표본오차 σ_w/√n 을 둘 다 포함한다.')
print('     저N 에서는 후자가 크므로 달성 가능한 R² 의 상한 자체가 1 이 아니다.')
print('     ICC 표의 σ_b·σ_w 로 상한을 계산해 같이 본다:')
for lo, hi in BANDS:
    q = TE & (Nb >= lo) & (Nb <= hi)
    if q.sum() < 200:
        continue
    import icc_oracle as C
    sel = K.TUNE & (Nb >= lo) & (Nb <= hi)
    _, sb, sw = C.icc(sel, np.zeros(len(Nb)))
    nbar = Nb[q].mean()
    cap = sb ** 2 / (sb ** 2 + sw ** 2 / max(nbar, 1))
    y, pp = Y[q], m.predict(X[q])
    r2 = 1 - ((y - pp) ** 2).sum() / ((y - y.mean()) ** 2).sum()
    print('   N %-8s R² %6.3f / 상한 %5.3f  ⟹ 회차 수준의 %5.1f%% 를 사전에 안다'
          % ('%d-%d' % (lo, hi), r2, cap, 100 * max(r2, 0) / max(cap, 1e-9)))
