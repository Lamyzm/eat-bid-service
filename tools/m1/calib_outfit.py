# -*- coding: utf-8 -*-
"""모듈 책임: M1 의 승률이 **화면에 보여줄 만큼** 맞나 — 적합 밖 보정 측정.

🔴 argmax 성능(오늘 확인됨)과 별개 질문이다. ADR 0027 조건 2가 요구하는 것.
사용자가 넣을 금액에서 확률을 내는 용도이므로 **실제 투찰 x 에서** 잰다.
"""
import numpy as np
import sys
import time

t0 = time.time()


def log(*a):
    print('[%6.1fs]' % (time.time() - t0), *a)
    sys.stdout.flush()


import fx_kernel as K

HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)
_hs = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([_hs.get(b, '') for b in K.BL['bid_id']])
OUT = K.USABLE & np.isin(split, ['TUNE', 'HOLD_A', 'HOLD_B'])
rows = np.flatnonzero(OUT[K.aid])
log('적합 밖 투찰 %d' % len(rows))

NE = K.nbid[K.aid[rows]]
XE = K.x[rows]
ACT = K.ACT_ALL[rows].astype(bool)
UE = np.unique(NE)
FE = K.Fx_at(UE, 0.02)
fe = {int(v): i for i, v in enumerate(UE)}

P = np.empty(len(rows))
for v in UE:
    q = np.flatnonzero(NE == v)
    P[q] = K.pwin_v(XE[q], FE[fe[int(v)]], np.full(len(q), v))
log('예측 완료')

print('\n' + '=' * 70)
print('M1 보정 — 적합 밖 %d 투찰. 실제 투찰 x 에서의 예측 승률' % len(rows))
print('=' * 70)
print('  전체   예측 평균 %.4f%%   실제 %.4f%%   편차 %+.4f%%p'
      % (100 * P.mean(), 100 * ACT.mean(), 100 * (P.mean() - ACT.mean())))

print('\n십분위별 (예측 확률로 정렬)')
qs = np.quantile(P, np.linspace(0, 1, 11))
print('  %-4s %9s %10s %10s %10s' % ('구간', 'n', '예측', '실제', '편차%p'))
for i in range(10):
    g = (P >= qs[i]) & (P <= qs[i + 1])
    if g.sum() == 0:
        continue
    print('  %-4d %9d %9.4f%% %9.4f%% %+9.4f'
          % (i + 1, g.sum(), 100 * P[g].mean(), 100 * ACT[g].mean(),
             100 * (P[g].mean() - ACT[g].mean())))

print('\nN 층별 (제품이 서는 자리 확인)')
print('  %-9s %9s %10s %10s %10s %8s' % ('N', 'n', '예측', '실제', '편차%p', '비'))
for lo, hi in [(3, 10), (11, 20), (21, 40), (41, 80), (81, 10 ** 9)]:
    g = (NE >= lo) & (NE <= hi)
    if g.sum() == 0:
        continue
    pm, am = P[g].mean(), ACT[g].mean()
    print('  %-9s %9d %9.4f%% %9.4f%% %+9.4f %7.3f'
          % ('%d-%s' % (lo, hi if hi < 10 ** 8 else '+'), g.sum(),
             100 * pm, 100 * am, 100 * (pm - am), pm / am if am else 0))

# Murphy 분해: Brier = reliability - resolution + uncertainty
bs = np.mean((P - ACT) ** 2)
unc = ACT.mean() * (1 - ACT.mean())
nb = 20
edges = np.quantile(P, np.linspace(0, 1, nb + 1))
rel = res = 0.0
for i in range(nb):
    g = (P >= edges[i]) & (P <= edges[i + 1])
    if g.sum() == 0:
        continue
    w = g.sum() / len(P)
    rel += w * (P[g].mean() - ACT[g].mean()) ** 2
    res += w * (ACT[g].mean() - ACT.mean()) ** 2
print('\nMurphy 분해 (20분위)')
print('  Brier %.6f = 신뢰도 %.6f − 분해능 %.6f + 불확실성 %.6f'
      % (bs, rel, res, unc))
print('  기술점수 (1 − Brier/불확실성) = %.4f' % (1 - bs / unc))
print('  ⚠ 신뢰도는 0 에 가까울수록 좋다. 분해능은 클수록 좋다.')
log('완료')
