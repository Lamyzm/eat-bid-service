"""모듈 책임: N 40~70 회차 내 백분위별 낙찰 배수를 1/N과 메커니즘 예측으로 비교한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; Rs=D['R_suspect']; R=D['R']; wd=D['wd']
pm=np.load('pm.npy')
N=off[rounds]
sub=(N>=40)&(N<=70)&(~Rs[rounds])
print(f"N 40~70 투찰 {sub.sum():,}  회차 {len(np.unique(rounds[sub])):,}  (주장 109만)")
# 회차 내 x 백분위 (오름차순 순위 / N)
o=np.lexsort((x,rounds)); rk=np.empty(len(x),np.int64)
rs=rounds[o]; nw=np.empty(len(rs),bool); nw[0]=True; nw[1:]=rs[1:]!=rs[:-1]
pos=np.arange(len(rs))-np.maximum.accumulate(np.where(nw,np.arange(len(rs)),0))
rk[o]=pos
pct=rk/np.maximum(N-1,1)
base_rate=win[sub].mean()
print(f"기준 낙찰률 {base_rate:.5f} (=1/평균N)")
print("\n투찰가 백분위(오름차순, 0=최저가) 10분위별 낙찰률 / 평균:")
b=np.digitize(pct,np.arange(0.1,1.0,0.1))
for k in range(10):
    m=sub&(b==k)
    print(f"  {k*10:>3}~{k*10+10:>3}%  n={m.sum():>8,}  낙찰률 {win[m].mean():.5f}  배수 {win[m].mean()/base_rate:.3f}   예측(메커니즘) 배수 {pm[m].mean()/base_rate:.3f}  평균x {x[m].mean():.5f}")
print("\n내림차순(0=최고가) 기준:")
pct2=1-pct; b2=np.digitize(pct2,np.arange(0.1,1.0,0.1))
for k in range(10):
    m=sub&(b2==k)
    print(f"  {k*10:>3}~{k*10+10:>3}%  n={m.sum():>8,}  낙찰률 {win[m].mean():.5f}  배수 {win[m].mean()/base_rate:.3f}  예측 배수 {pm[m].mean()/base_rate:.3f}")
# R 이 회차 x 분포의 몇 번째 백분위에 떨어지나
Rr=R[rounds]
belowR=np.bincount(rounds,weights=(x<Rr).astype(float),minlength=nR)
Rpct=belowR/np.maximum(off,1)
print(f"\nR 의 회차내 x-백분위 분위: {np.round(np.percentile(Rpct[(off>=40)&(off<=70)&~Rs],[5,25,50,75,95]),3).tolist()}")
print(f"낙찰자의 회차내 백분위 분위: {np.round(np.percentile(pct[win&sub],[5,25,50,75,95]),3).tolist()}  평균 {pct[win&sub].mean():.3f}")
