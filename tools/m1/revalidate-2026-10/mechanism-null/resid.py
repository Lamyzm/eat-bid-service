"""모듈 책임: 메커니즘 귀무 대비 업체 z의 관측 sd와 귀무 sd를 비교한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; R=D['R']
pm=np.load('pm.npy')
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
# 규칙 일치 회차
xw=np.zeros(nR); xw[rounds[win]]=x[win]
Rr=R[rounds]; startpos=np.concatenate([[0],np.cumsum(off)[:-1]])
xe=np.where(x>=Rr,x,1e18); o=np.lexsort((xe,rounds)); agree=np.isclose(xe[o[startpos]],xw,rtol=1e-6)
S=np.bincount(rounds,weights=pm,minlength=nR)
rng=np.random.default_rng(23)
def run(mask,label,B=200):
    E=np.bincount(inv[mask],weights=pm[mask],minlength=nb)
    V=np.bincount(inv[mask],weights=(pm*(1-pm))[mask],minlength=nb)
    A=np.bincount(inv[mask],weights=win[mask].astype(float),minlength=nb)
    C=np.bincount(inv[mask],minlength=nb); s=(C>=100)&(V>0)
    Z=(A[s]-E[s])/np.sqrt(V[s])
    # 순열
    mi=np.flatnonzero(mask); ro=rounds[mi]; po=pm[mi]; ivo=inv[mi]
    cnt=np.bincount(ro,minlength=nR); tot=np.bincount(ro,weights=po,minlength=nR)
    csum=np.cumsum(po); bse=np.concatenate([[0.0],csum[np.cumsum(cnt)-1]])[:-1]
    rsel=np.flatnonzero((cnt>0)&(tot>0.99))
    Ep=np.bincount(ivo,weights=po,minlength=nb); Vp=np.bincount(ivo,weights=po*(1-po),minlength=nb)
    Cp=np.bincount(ivo,minlength=nb); sp=(Cp>=100)&(Vp>0)
    sds=np.empty(B)
    for b in range(B):
        u=rng.random(len(rsel))*tot[rsel]+bse[rsel]
        pos=np.searchsorted(csum,u,side='left')
        Ap=np.bincount(ivo[pos],minlength=nb).astype(float)
        sds[b]=((Ap[sp]-Ep[sp])/np.sqrt(Vp[sp])).std()
    exc=Z.std()**2-sds.mean()**2
    print(f"{label}: 업체 {s.sum():,}  관측 sd {Z.std():.4f}  null {sds.mean():.4f}±{sds.std():.4f}  "
          f"z={(Z.std()-sds.mean())/sds.std():+.1f}  초과분산 {exc:+.4f}")
    return Z,s
base_m=(~Rs[rounds])
run(base_m,"전체(R_suspect 제외)")
run(base_m&agree[rounds],"+ 규칙일치 회차만")
run(base_m&agree[rounds]&(S[rounds]>0.999),"+ 회차 p합>0.999")
run(base_m&agree[rounds]&(S[rounds]>0.9999)&(off[rounds]>=2),"+ p합>0.9999 & N>=2")
