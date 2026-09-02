# -*- coding: utf-8 -*-
"""사전 등록 3f0eec4 실행. 진단 먼저, 성능 나중."""
import numpy as np
import sys
import time
from math import comb, erfc

t0 = time.time()


def log(*a):
    print('[%6.1fs]' % (time.time() - t0), *a)
    sys.stdout.flush()


import fx_kernel as K
import m4_gbdt as M4
import m5_rerun as M5

# ---------- 평가 표본: TUNE + HOLD, 적합 밖 ----------
HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)
_hs = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([_hs.get(b, '') for b in K.BL['bid_id']])
OUTFIT = K.USABLE & np.isin(split, ['TUNE', 'HOLD_A', 'HOLD_B'])
rng = np.random.default_rng(7)
pool = np.flatnonzero(OUTFIT[K.aid] & M4._ok[K.aid])
EV = np.sort(rng.choice(pool, 200000, replace=False))
TRPOOL = np.flatnonzero(K.TRAIN[K.aid] & M4._ok[K.aid] & ~M4.IS_F)
CSEL = np.sort(rng.choice(TRPOOL, 300000, replace=False))
log('평가 %d 투찰 (적합 밖) · 상수 선택용 학습기 %d' % (len(EV), len(CSEL)))

# ---------- 채점 기계 (team-lead 검증본: 기록 낙찰자 99.92% 재현) ----------
x = K.x
R = K.R
aid = K.aid
off = K.cnt
n = len(off)
start = np.cumsum(off) - off
Rb = R[aid]
xa = np.where(x >= Rb, x, np.inf)
o = np.lexsort((xa, aid))
rank = np.empty(len(x), np.int64)
rank[o] = np.arange(len(x)) - start[aid[o]]
f1 = np.full(n, np.inf)
f2 = np.full(n, np.inf)
s = rank == 0
f1[aid[s]] = xa[s]
s = rank == 1
f2[aid[s]] = xa[s]
MCOMP = np.where(rank == 0, f2[aid], f1[aid])


def wins(rows, xv):
    return (xv >= Rb[rows]) & (MCOMP[rows] >= xv)


log('채점 기계 준비. 전수 재현 낙찰 %d vs 기록 %d'
    % (((x >= Rb) & (MCOMP >= x)).sum(), K.BL['is_recorded_winner'].sum()))

# ---------- 상수: 학습기에서 고른다 (창 안 최댓값 금지) ----------
GRID = M4.GRID
rc = np.array([wins(CSEL, v).mean() for v in GRID])
X0 = GRID[rc.argmax()]
log('상수 선택: 학습기 30만에서 x0=%.4f (%.3f%%)' % (X0, 100 * rc.max()))

# ---------- M5 적합 ----------
log('M5 적합 시작 (150만 행)...')
m5, sc = M5.fit()
log('M5 적합 끝')

# ---------- D1 / D2 / D3 진단 먼저 ----------
print('\n' + '=' * 72)
print('진단 - 사전 등록 2절. 성능보다 먼저 낸다')
print('=' * 72)
DS = EV[rng.choice(len(EV), 20000, replace=False)]
P5 = M5.pcurve(m5, sc, DS, GRID)
ch = GRID[P5.argmax(1)]
u, c = np.unique(ch, return_counts=True)
print('\nD1  선택된 x 의 분포 (표본 20,000)')
for i in np.argsort(-c)[:5]:
    mark = '   <- 격자 끝점' if u[i] in (GRID[0], GRID[-1]) else ''
    print('     x=%.4f  %6.2f%%%s' % (u[i], 100 * c[i] / len(ch), mark))
mx = 100 * c.max() / len(ch)
print('     최대 쏠림 %.2f%%   판정: %s' % (mx, '퇴화 (>=20%)' if mx >= 20 else '정상'))

print('\nD2  p(x) 곡선의 기복 - M1 과 대조')
rel5 = (P5.max(1) - P5.min(1)) / np.maximum(P5.max(1), 1e-12)
NN = K.nbid[K.aid[DS]]
UN = np.unique(NN)
F1 = K.Fx_at(UN, 0.02)
fidx = {int(v): i for i, v in enumerate(UN)}
P1 = np.empty((len(DS), len(GRID)))
for v in UN:
    q = np.flatnonzero(NN == v)
    Fx = F1[fidx[int(v)]]
    for j, xv in enumerate(GRID):
        P1[q, j] = K.pwin_v(np.full(len(q), xv), Fx, np.full(len(q), v))
rel1 = (P1.max(1) - P1.min(1)) / np.maximum(P1.max(1), 1e-12)
print('     M5 (최대-최소)/최대  중앙 %.4f' % np.median(rel5))
print('     M1 (최대-최소)/최대  중앙 %.4f' % np.median(rel1))
ratio = np.median(rel5) / max(np.median(rel1), 1e-12)
print('     비 %.3f   판정: %s' % (ratio, '평평함 (<0.2)' if ratio < 0.2 else '정상'))

print('\nD3  보정 - 예측 확률 십분위별 실제 낙찰률')
pact = m5.predict_proba(sc.transform(M5.mat(DS, K.x[DS])))[:, 1]
qs = np.quantile(pact, np.linspace(0, 1, 11))
act = K.ACT_ALL[DS]
print('     십분위   예측평균    실제')
for i in range(10):
    g = (pact >= qs[i]) & (pact <= qs[i + 1])
    if g.sum() == 0:
        continue
    print('       %2d    %7.4f%%  %7.4f%%' % (i + 1, 100 * pact[g].mean(), 100 * act[g].mean()))

# ---------- 성능 ----------
print('\n' + '=' * 72)
print('성능 - 적합 밖 20만')
print('=' * 72)
log('M4 적합...')
m4 = M4.fit()
log('결정 M4...')
d4 = M4.decide(m4, EV)
log('결정 M5...')
d5 = M5.decide(m5, sc, EV)
log('결정 M1...')
NE = K.nbid[K.aid[EV]]
d1 = np.empty(len(EV))
UE = np.unique(NE)
FE = K.Fx_at(UE, 0.02)
fe = {int(v): i for i, v in enumerate(UE)}
for v in UE:
    q = np.flatnonzero(NE == v)
    Fx = FE[fe[int(v)]]
    P = np.empty((len(q), len(GRID)))
    for j, xv in enumerate(GRID):
        P[:, j] = K.pwin_v(np.full(len(q), xv), Fx, np.full(len(q), v))
    d1[q] = GRID[P.argmax(1)]
log('결정 끝')


def mcn(a, b_):
    bb = int((b_ & ~a).sum())
    cc = int((a & ~b_).sum())
    if bb + cc == 0:
        return bb, cc, 1.0
    if bb + cc > 1000:
        z = (abs(bb - cc) - 1) / np.sqrt(bb + cc)
        return bb, cc, erfc(z / np.sqrt(2))
    return bb, cc, min(1.0, 2 * sum(comb(bb + cc, k) for k in range(min(bb, cc) + 1)) / 2 ** (bb + cc))


human = K.ACT_ALL[EV].astype(bool)
lot = (1.0 / NE).mean()
DEC = {'상수(학습기선택)': np.full(len(EV), X0), 'M4 GBDT': d4,
       'M5 신경망(예산맞춤)': d5, 'M1 구조': d1}
res = {k: wins(EV, v) for k, v in DEC.items()}
print('\n%-22s %8s  %s' % ('', '낙찰률', 'vs 사람 McNemar'))
print('%-22s %7.3f%%' % ('사람', 100 * human.mean()))
print('%-22s %7.3f%%   (항등식 · 참고)' % ('제비뽑기 1/N', 100 * lot))
for k, w in res.items():
    b_, c_, p = mcn(human, w)
    print('%-22s %7.3f%%   b=%-6d c=%-6d p=%.3g' % (k, 100 * w.mean(), b_, c_, p))

print('\nN 층별 - 기준선은 제비뽑기와 상수 중 높은 쪽 (규율 38 정정)')
print('%-9s %8s %8s %8s %8s %8s %8s %8s'
      % ('N', 'n', '사람', '제비뽑기', '상수', 'M4', 'M5', 'M1'))
for lo, hi in [(3, 20), (21, 40), (41, 10 ** 9)]:
    q = np.flatnonzero((NE >= lo) & (NE <= hi))
    if not len(q):
        continue
    print('%-9s %8d %7.3f%% %7.3f%% %7.3f%% %7.3f%% %7.3f%% %7.3f%%'
          % ('%d-%s' % (lo, hi if hi < 10 ** 8 else '+'), len(q), 100 * human[q].mean(),
             100 * (1.0 / NE[q]).mean(), 100 * res['상수(학습기선택)'][q].mean(),
             100 * res['M4 GBDT'][q].mean(), 100 * res['M5 신경망(예산맞춤)'][q].mean(),
             100 * res['M1 구조'][q].mean()))

print('\n낙찰 시 평균 x (사람 낙찰 시 평균 대비)')
hx = K.x[EV][human].mean()
for k, w in res.items():
    if w.sum():
        print('  %-22s %+.3f%%' % (k, 100 * (DEC[k][w].mean() / hx - 1)))
log('완료')
