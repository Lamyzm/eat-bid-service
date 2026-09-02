# -*- coding: utf-8 -*-
"""모듈 책임: data-inventory 의 핵심 주장을 독립 확인한다 — 16축 회귀 없이, 두 변수로.

주장: "실력은 *위치*다. 낮게, R 에 바짝 붙이는 사업자가 더 낙찰한다."
   (회차 내 x 백분위 계수 0.954 · x-R 중앙 계수 0.975 — 둘 다 1 미만 = 낮을수록 유리)

확인 방법: 사업자별로 (1) 회차 내 x 백분위 중앙 (2) 제비뽑기 대비 낙찰 배수
          를 만들고 관계를 본다. 회귀도 축도 안 쓴다.
⚠ 시간 분할: 위치는 **정의기간**, 배수는 **측정기간**. 같은 자료로 순환 안 하게.
"""
import numpy as np
from scipy import stats

d = np.load('data/mechanism/xcap2.npz', allow_pickle=True)
x = d['x'].astype(np.float64)
R = d['R_hybrid'].astype(float)
RSUS = d['R_suspect']
off = d['off'].astype(np.int64)
biz = d['biz_no']
ym = d['ym'].astype(int)
N = d['n_pool'].astype(np.int64)
win = d['is_recorded_winner']
n = len(off)
aid = np.repeat(np.arange(n), off)
start = np.cumsum(off) - off
Rb = R[aid]
Nb = N[aid]

# 회차 내 x 백분위 (0 = 최저가, 1 = 최고가). 정렬 한 번으로.
o = np.lexsort((x, aid))
rk = np.empty(len(x), np.int64)
rk[o] = np.arange(len(x)) - start[aid[o]]
pct = rk / np.maximum(Nb - 1, 1)
xmR = x - Rb

ok = (~RSUS[aid]) & (Nb >= 3)
DEF = ok & (ym[aid] <= 202512)          # 정의기간: 위치를 잰다
MEA = ok & (ym[aid] >= 202601)          # 측정기간: 성적을 잰다

uniq, inv = np.unique(biz, return_inverse=True)
nb = len(uniq)


def agg(mask):
    c = np.bincount(inv[mask], minlength=nb)
    return c


cD = agg(DEF)
cM = agg(MEA)
gate = (cD >= 100) & (cM >= 30)
print('정의기간 100+ 이고 측정기간 30+ 인 사업자: %d' % gate.sum())

# 정의기간 위치
sp = np.bincount(inv[DEF], weights=pct[DEF], minlength=nb)
sd_ = np.bincount(inv[DEF], weights=xmR[DEF], minlength=nb)
pos_pct = np.divide(sp, cD, out=np.full(nb, np.nan), where=cD > 0)
pos_xmR = np.divide(sd_, cD, out=np.full(nb, np.nan), where=cD > 0)

# 측정기간 배수
wM = np.bincount(inv[MEA], weights=win[MEA].astype(float), minlength=nb)
eM = np.bincount(inv[MEA], weights=1.0 / Nb[MEA], minlength=nb)
mult = np.divide(wM, eM, out=np.full(nb, np.nan), where=eM > 0)

g = gate & np.isfinite(pos_pct) & np.isfinite(mult) & (eM > 0)
P, X, M = pos_pct[g], pos_xmR[g], mult[g]
print('분석 대상 %d 사업자' % g.sum())
print()
print('=== 주장 확인: 낮게 놓는 사업자가 나중에 더 낙찰하나 ===')
for nm, v in [('회차 내 x 백분위 (낮을수록 아래)', P), ('x - R 평균 (낮을수록 R 에 가까움)', X)]:
    r, p = stats.spearmanr(v, M)
    print('  %-34s  rho(위치, 나중 배수) = %+.4f   p=%.2e' % (nm, r, p))
    print('     ⟹ 음수면 "낮게 놓을수록 나중에 잘한다" = 주장과 일치')

print()
print('=== 5분위로 본다 (정의기간 백분위 기준) ===')
qs = np.quantile(P, np.linspace(0, 1, 6))
print('  %-6s %7s %14s %16s' % ('분위', 'n', '정의기간 백분위', '측정기간 배수'))
for i in range(5):
    s = (P >= qs[i]) & (P <= qs[i + 1])
    if s.sum() == 0:
        continue
    print('  Q%-5d %7d %14.4f %16.4f' % (i + 1, s.sum(), P[s].mean(), np.median(M[s])))
print('  ⟹ Q1 = 가장 낮게 놓는 20%.  Q5 = 가장 높게.')

print()
print('=== 대조: "선택"은 어떤가 (data-inventory 는 0.0075 라 했다) ===')
lnN = np.bincount(inv[DEF], weights=np.log(Nb[DEF]), minlength=nb)
selN = np.divide(lnN, cD, out=np.full(nb, np.nan), where=cD > 0)[g]
r, p = stats.spearmanr(selN, M)
print('  평균 log N (어느 회차를 고르나)   rho = %+.4f   p=%.2e' % (r, p))
r2, p2 = stats.spearmanr(cD[g], M)
print('  정의기간 투찰 수 (활동량)         rho = %+.4f   p=%.2e' % (r2, p2))
print()
print('⚠ 배수는 N 에 의존하지 않게 Sum(1/N) 로 정규화했다. 그래도 잔여 교란은 있다.')
