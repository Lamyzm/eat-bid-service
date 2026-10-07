"""모듈 책임: N 대역×백분위 80칸 격자의 다중비교를 순열 maxT로 보정한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; Rs=D['R_suspect']
pm=np.load('pm.npy'); N=off[rounds]
ok=(~Rs[rounds])
# 회차내 백분위
o2=np.lexsort((x,rounds)); rs2=rounds[o2]
nw=np.empty(len(rs2),bool); nw[0]=True; nw[1:]=rs2[1:]!=rs2[:-1]
rk=np.empty(len(x),np.int64); rk[o2]=np.arange(len(rs2))-np.maximum.accumulate(np.where(nw,np.arange(len(rs2)),0))
pct=rk/np.maximum(N-1,1)
bands=[(2,5),(6,10),(11,20),(21,40),(40,70),(71,120),(121,200),(201,400)]
dec=np.clip((pct*10).astype(int),0,9)
cells=[]; cid=np.full(len(x),-1,np.int64)
for bi,(lo,hi) in enumerate(bands):
    m=ok&(N>=lo)&(N<=hi)
    cid[m]=bi*10+dec[m]
ncell=len(bands)*10
E=np.bincount(cid[cid>=0],weights=pm[cid>=0],minlength=ncell)
V=np.bincount(cid[cid>=0],weights=(pm*(1-pm))[cid>=0],minlength=ncell)
A=np.bincount(cid[cid>=0],weights=win[cid>=0].astype(float),minlength=ncell)
C=np.bincount(cid[cid>=0],minlength=ncell)
T=(A-E)/np.sqrt(np.maximum(V,1e-9))
print("=== 주장3 가족: N대역 8 x 백분위 10분위 = 80칸, 메커니즘 null 대비 t ===")
print(f"|t| 최대 {np.abs(T).max():.2f} at cell {np.argmax(np.abs(T))} (N대역 {bands[np.argmax(np.abs(T))//10]}, 분위 {np.argmax(np.abs(T))%10})")
# 순열 maxT
okidx=np.flatnonzero(ok&(cid>=0)); ro=rounds[okidx]; po=pm[okidx]; co=cid[okidx]
cnt=np.bincount(ro,minlength=nR); tot=np.bincount(ro,weights=po,minlength=nR)
csum=np.cumsum(po); bse=np.concatenate([[0.0],csum[np.cumsum(cnt)-1]])[:-1]
rsel=np.flatnonzero((cnt>0)&(tot>0.99))
rng=np.random.default_rng(99)
mx=np.empty(300)
for b in range(300):
    u=rng.random(len(rsel))*tot[rsel]+bse[rsel]
    pos=np.searchsorted(csum,u,side='left')
    Ap=np.bincount(co[pos],minlength=ncell).astype(float)
    mx[b]=np.abs((Ap-E)/np.sqrt(np.maximum(V,1e-9))).max()
print(f"순열 null 하 max|t| : 평균 {mx.mean():.2f}  95%분위 {np.percentile(mx,95):.2f}  최대 {mx.max():.2f}")
print(f"-> 관측 max|t| {np.abs(T).max():.2f} 의 다중비교 보정 p = {(mx>=np.abs(T).max()).mean():.3f}")
# N 40-70 x 최하위10% 칸만
c=bands.index((40,70))*10+0
print(f"\n주장3이 보고한 칸 (N 40~70, 최하위 10%): 실제 {A[c]:.0f}  메커니즘기대 {E[c]:.1f}  배 {A[c]/E[c]:.3f}  t={T[c]:+.2f}")
c2=bands.index((40,70))*10+5
print(f"  (N 40~70, 50~60%):               실제 {A[c2]:.0f}  메커니즘기대 {E[c2]:.1f}  배 {A[c2]/E[c2]:.3f}  t={T[c2]:+.2f}")
print(f"  1/N 기준이면 배수는 각각 {A[c]/C[c]/(1/np.mean(N[ok&(cid==c)])):.3f}, {A[c2]/C[c2]/(1/np.mean(N[ok&(cid==c2)])):.3f}")
