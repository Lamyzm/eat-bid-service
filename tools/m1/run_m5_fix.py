# -*- coding: utf-8 -*-
"""M5a — 격자를 관측 지지집합으로 제한한 재실행. 사전 등록 2026-09-02-PREREG-m5-fix.md.

🔴 한 곳만 바꾼다: 격자. 구조·특징·행 수·seed 전부 동일.
"""
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

# ---------- 앞선 실행과 동일한 표본 (seed 7) ----------
HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)
_hs = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([_hs.get(b, '') for b in K.BL['bid_id']])
OUTFIT = K.USABLE & np.isin(split, ['TUNE', 'HOLD_A', 'HOLD_B'])
rng = np.random.default_rng(7)
pool = np.flatnonzero(OUTFIT[K.aid] & M4._ok[K.aid])
EV = np.sort(rng.choice(pool, 200000, replace=False))
TRPOOL = np.flatnonzero(K.TRAIN[K.aid] & M4._ok[K.aid] & ~M4.IS_F)
CSEL = np.sort(rng.choice(TRPOOL, 300000, replace=False))
log('평가 %d · 상수선택 %d (앞선 실행과 동일 seed)' % (len(EV), len(CSEL)))

# ---------- 채점 기계 ----------
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


# ---------- 격자 후보 셋 ----------
XTR = K.x[np.flatnonzero(K.TRAIN[K.aid])]
GRIDS = {}
for lo_q, hi_q in [(1.0, 99.0), (5.0, 95.0), (0.5, 99.5)]:
    lo, hi = np.percentile(XTR, [lo_q, hi_q])
    GRIDS['[%.1f%%, %.1f%%]' % (lo_q, hi_q)] = (np.linspace(lo, hi, 86), lo, hi)
    log('격자 %s → [%.5f, %.5f]' % ('[%.1f%%, %.1f%%]' % (lo_q, hi_q), lo, hi))
GOLD = M4.GRID

# ---------- 상수 (원래 격자에서, 앞선 실행과 동일) ----------
rc = np.array([wins(CSEL, v).mean() for v in GOLD])
X0 = GOLD[rc.argmax()]
log('상수 x0=%.4f' % X0)

# ---------- M5 적합 (앞선 실행과 동일 seed·예산) ----------
log('M5 적합 (150만 행)...')
m5, sc = M5.fit()
log('적합 끝')

# ---------- 🔴 D1' / D2' 진단 ----------
print('\n' + '=' * 74)
print("진단 D1' · D2' — 사전 등록 1절. 성능보다 먼저")
print('=' * 74)
DS = EV[rng.choice(len(EV), 20000, replace=False)]
DIAG = {}
for name, (g, lo, hi) in GRIDS.items():
    P = M5.pcurve(m5, sc, DS, g)
    am = P.argmax(1)
    ch = g[am]
    u, c = np.unique(ch, return_counts=True)
    pile = 100 * c.max() / len(ch)
    at_lo = 100 * np.mean(am == 0)
    interior = 100 * np.mean((am > 0) & (am < len(g) - 1))
    DIAG[name] = (pile, at_lo, interior)
    print('\n격자 %s  [%.5f, %.5f]' % (name, lo, hi))
    print("  D1'  최대 쏠림 %5.2f%%   **새 하한 쏠림 %5.2f%%**   %s"
          % (pile, at_lo, '<- 퇴화 (>=20%)' if at_lo >= 20 else '정상'))
    print("  D2'  argmax 가 내부점인 행 %5.2f%%   %s"
          % (interior, '<- 여전히 단조 (<50%)' if interior < 50 else '봉우리 있음'))

# 참고: 원래 격자
P0 = M5.pcurve(m5, sc, DS, GOLD)
print('\n(참고) 원래 격자 [0.960,1.045]  하한 쏠림 %.2f%%'
      % (100 * np.mean(P0.argmax(1) == 0)))

# ---------- 성능 ----------
print('\n' + '=' * 74)
print('성능 — 적합 밖 20만')
print('=' * 74)
log('M4 적합...')
m4 = M4.fit()
d4 = M4.decide(m4, EV)
log('M5 원래 격자...')
d5o = M5.decide(m5, sc, EV)


def decide_grid(g, chunk=8000):
    out = np.empty(len(EV))
    for a in range(0, len(EV), chunk):
        r = EV[a:a + chunk]
        P = M5.pcurve(m5, sc, r, g)
        out[a:a + len(r)] = g[P.argmax(1)]
    return out


D5 = {}
for name, (g, lo, hi) in GRIDS.items():
    log('M5a %s...' % name)
    D5[name] = decide_grid(g)
log('M1...')
NE = K.nbid[K.aid[EV]]
d1 = np.empty(len(EV))
UE = np.unique(NE)
FE = K.Fx_at(UE, 0.02)
fe = {int(v): i for i, v in enumerate(UE)}
for v in UE:
    q = np.flatnonzero(NE == v)
    Fx = FE[fe[int(v)]]
    P = np.empty((len(q), len(GOLD)))
    for j, xv in enumerate(GOLD):
        P[:, j] = K.pwin_v(np.full(len(q), xv), Fx, np.full(len(q), v))
    d1[q] = GOLD[P.argmax(1)]
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
DEC = {'상수(x0=%.4f)' % X0: np.full(len(EV), X0), 'M4 GBDT': d4,
       'M5 원래격자': d5o}
for name in GRIDS:
    DEC['M5a %s' % name] = D5[name]
DEC['M1 구조'] = d1
res = {k: wins(EV, v) for k, v in DEC.items()}

print('\n%-24s %9s   %s' % ('', '낙찰률', 'McNemar vs 사람'))
print('%-24s %8.3f%%' % ('사람', 100 * human.mean()))
print('%-24s %8.3f%%   (항등식)' % ('제비뽑기 1/N', 100 * lot))
for k, w in res.items():
    b_, c_, p = mcn(human, w)
    print('%-24s %8.3f%%   b=%-6d c=%-6d p=%.3g' % (k, 100 * w.mean(), b_, c_, p))

# M5a 최고 vs 상수 / M4 직접 대결
best = max(GRIDS, key=lambda k: res['M5a %s' % k].mean())
wb = res['M5a %s' % best]
print('\n직접 대결 (McNemar) — M5a %s' % best)
for opp in ['상수(x0=%.4f)' % X0, 'M4 GBDT', 'M1 구조']:
    b_, c_, p = mcn(res[opp], wb)
    verdict = '이김' if b_ > c_ else '짐'
    print('  vs %-22s b=%-6d c=%-6d p=%.3g   %s' % (opp, b_, c_, p, verdict))

print('\nN 층별')
hdr = ['N', 'n', '사람', '제비', '상수', 'M4', 'M5a', 'M1']
print(('%-8s' + '%10s' * 7) % tuple(hdr))
for lo_, hi_ in [(3, 20), (21, 40), (41, 10 ** 9)]:
    q = np.flatnonzero((NE >= lo_) & (NE <= hi_))
    if not len(q):
        continue
    print(('%-8s' + '%10d' + '%9.3f%%' * 6)
          % ('%d-%s' % (lo_, hi_ if hi_ < 10 ** 8 else '+'), len(q),
             100 * human[q].mean(), 100 * (1.0 / NE[q]).mean(),
             100 * res['상수(x0=%.4f)' % X0][q].mean(), 100 * res['M4 GBDT'][q].mean(),
             100 * wb[q].mean(), 100 * res['M1 구조'][q].mean()))

print('\n낙찰 시 평균 x (사람 낙찰 시 대비)')
hx = K.x[EV][human].mean()
for k, w in res.items():
    if w.sum():
        print('  %-24s %+.3f%%' % (k, 100 * (DEC[k][w].mean() / hx - 1)))
log('완료')
