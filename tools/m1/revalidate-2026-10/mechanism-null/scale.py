"""모듈 책임: 임계값 격자별 메커니즘 sd와 함축 상대우위로 고정 우위 모형과의 불일치를 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; x=D['x'].astype(np.float64); R=D['R']
pm=np.load('pm.npy'); ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
xw=np.zeros(nR); xw[rounds[win]]=x[win]; Rr=R[rounds]
sp0=np.concatenate([[0],np.cumsum(off)[:-1]])
xe=np.where(x>=Rr,x,1e18); o2=np.lexsort((xe,rounds)); agree=np.isclose(xe[o2[sp0]],xw,rtol=1e-6)
ok=(~Rs[rounds])&agree[rounds]
f=lambda m,w: np.bincount(inv[m],weights=w,minlength=nb)
E=f(ok,pm[ok]); V=f(ok,(pm*(1-pm))[ok]); A=f(ok,win[ok].astype(float)); C=np.bincount(inv[ok],minlength=nb)
print("임계값   업체     평균 기대낙찰 E   sd(z)   초과분산   함축 per-bid 상대우위 theta=sqrt(초과/meanE)")
for thr in [30,100,300,1000,3000]:
    s=(C>=thr)&(V>0); Z=(A[s]-E[s])/np.sqrt(V[s])
    exc=Z.std()**2-1.0
    th=np.sqrt(max(exc,0)/E[s].mean())
    print(f"{thr:>5}  {s.sum():>6,}   {E[s].mean():>13.2f}   {Z.std():.4f}  {exc:+.4f}   theta={th:.4f}")
print("\n실력(업체마다 고정된 상대우위 theta)이 원인이라면 theta 는 임계값과 무관해야 한다.")
print("초과분산은 theta^2 * mean(E) 이므로 임계값을 올리면 sd(z) 가 커져야 한다. 관측은 평평하다.")
# 주장3 격자에서 가장 큰 칸의 효과크기
N=off[rounds]
o3=np.lexsort((x,rounds)); rs3=rounds[o3]
nw=np.empty(len(rs3),bool); nw[0]=True; nw[1:]=rs3[1:]!=rs3[:-1]
rk=np.empty(len(x),np.int64); rk[o3]=np.arange(len(rs3))-np.maximum.accumulate(np.where(nw,np.arange(len(rs3)),0))
pct=rk/np.maximum(N-1,1); dec=np.clip((pct*10).astype(int),0,9)
m=(~Rs[rounds])&(N>=121)&(N<=200)&(dec==9)
print(f"\n주장3 격자 최대 t 칸 (N 121~200, 최상위 10%): n={m.sum():,} 실제 {win[m].sum():,} 메커니즘기대 {pm[m].sum():.1f} 비 {win[m].sum()/pm[m].sum():.3f}")
