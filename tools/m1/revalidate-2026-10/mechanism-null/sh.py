"""모듈 책임: 같은 기간 투찰을 무작위로 양분한 분할반분 신뢰도로 지속 업체 특성을 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
from scipy.stats import spearmanr
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; x=D['x'].astype(np.float64); R=D['R']; wd=D['wd']
pm=np.load('pm.npy'); ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
xw=np.zeros(nR); xw[rounds[win]]=x[win]; Rr=R[rounds]
sp0=np.concatenate([[0],np.cumsum(off)[:-1]])
xe=np.where(x>=Rr,x,1e18); o2=np.lexsort((xe,rounds)); agree=np.isclose(xe[o2[sp0]],xw,rtol=1e-6)
ok=(~Rs[rounds])&agree[rounds]
live=~wd; Nl=np.bincount(rounds[live],minlength=nR)
okc=live&(~Rs[rounds])&(Nl[rounds]>0); pc=np.where(okc,1.0/np.maximum(Nl[rounds],1),0.0)
rng=np.random.default_rng(2024)
def half_rho(p,okm,reps=8,thr=50):
    out=[]
    for r in range(reps):
        h=rng.random(len(x))<0.5
        f=lambda m: (np.bincount(inv[m],weights=p[m],minlength=nb),
                     np.bincount(inv[m],weights=(p*(1-p))[m],minlength=nb),
                     np.bincount(inv[m],weights=win[m].astype(float),minlength=nb),
                     np.bincount(inv[m],minlength=nb))
        E1,V1,A1,C1=f(okm&h); E2,V2,A2,C2=f(okm&~h)
        s=(C1>=thr)&(C2>=thr)&(V1>0)&(V2>0)
        z1=(A1[s]-E1[s])/np.sqrt(V1[s]); z2=(A2[s]-E2[s])/np.sqrt(V2[s])
        out.append((spearmanr(z1,z2).statistic,int(s.sum())))
    a=np.array([o[0] for o in out])
    return a.mean(),a.std(),out[0][1]
m1,s1,n1=half_rho(pm,ok)
m2,s2,n2=half_rho(pc,okc)
print(f"분할반분 신뢰도 (같은 기간, 투찰을 무작위 양분, 업체당 각 반 50건+)")
print(f"  메커니즘 null z : rho = {m1:+.4f} (반복 8회 sd {s1:.4f})  업체 {n1:,}")
print(f"  1/N null z      : rho = {m2:+.4f} (반복 8회 sd {s2:.4f})  업체 {n2:,}")
print(f"  초과분산 0.12 가 고정된 업체 특성이라면 기대 rho = {0.12/1.12:.3f}")
print(f"  n={n1:,} 에서 rho 의 null sd = {1/np.sqrt(n1):.4f}")
# 주장2 rho 의 95% CI (메커니즘)
c=np.load('c2.npz'); zm1=c['zm1']; zm2=c['zm2']
r=spearmanr(zm1,zm2); n=len(zm1)
import math
zf=0.5*math.log((1+r.statistic)/(1-r.statistic)); se=1/math.sqrt(n-3)
lo=math.tanh(zf-1.96*se); hi=math.tanh(zf+1.96*se)
print(f"\n주장2 메커니즘 null rho = {r.statistic:+.4f}  95% CI [{lo:+.4f}, {hi:+.4f}]  n={n:,}")
