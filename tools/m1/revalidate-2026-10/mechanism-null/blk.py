"""모듈 책임: R을 공유하는 회차와 회차 블록 순열로 메커니즘 z의 귀무 분포를 만든다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; R=D['R']
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
Rc=np.sort(R[~Rs]); m=len(Rc)
F=lambda v: np.searchsorted(Rc,v,side='right')/m
o=np.lexsort((x,rounds)); xs=x[o]; rs=rounds[o]; ivs=inv[o]; wins=win[o]
nw=np.empty(len(xs),bool); nw[0]=True; nw[1:]=rs[1:]!=rs[:-1]
prev=np.empty(len(xs)); prev[0]=-1; prev[1:]=xs[:-1]; prev[nw]=-1
gstart=nw|(xs!=prev); gid=np.cumsum(gstart)-1
gsz=np.bincount(gid); lo=np.where(prev[gstart]<0,0.0,F(prev[gstart])); hi=F(xs[gstart])
Fhi=hi[gid]; pg=np.maximum(hi-lo,0.0); ps=(pg/gsz)[gid]
S=np.bincount(rs,weights=ps,minlength=nR)
pmn=np.where(S[rs]>0,ps/np.maximum(S[rs],1e-12),0.0)
# R 공유 그룹 (동일 R 값 = 같은 복수예비가격 추첨으로 추정)
uR,gR,cR=np.unique(R,return_inverse=True,return_counts=True)
print(f"R 고유값 {len(uR):,}  2개 이상 회차가 공유하는 R 값 {int((cR>1).sum()):,}  최대 공유 {cR.max()}  공유 회차 비율 {(cR[gR]>1).mean():.4f}")
# 회차 부분집합: 깨끗한 회차
xw=np.zeros(nR); xw[rounds[win]]=x[win]
Rr=R[rounds]; sp0=np.concatenate([[0],np.cumsum(off)[:-1]])
xe=np.where(x>=Rr,x,1e18); o2=np.lexsort((xe,rounds)); agree=np.isclose(xe[o2[sp0]],xw,rtol=1e-6)
keepR=(~Rs)&agree&(S>0.9999)&(off>=2)
print(f"사용 회차 {keepR.sum():,}")
mk=keepR[rs]
K=rs[mk]+Fhi[mk]
assert np.all(np.diff(K)>=0)
idxmap=np.flatnonzero(mk)
ivk=ivs[mk]; pk=pmn[mk]; rk=rs[mk]
E=np.bincount(ivk,weights=pk,minlength=nb); V=np.bincount(ivk,weights=pk*(1-pk),minlength=nb)
A=np.bincount(ivk,weights=wins[mk].astype(float),minlength=nb); C=np.bincount(ivk,minlength=nb)
s=(C>=100)&(V>0); Zobs=(A[s]-E[s])/np.sqrt(V[s])
print(f"관측 sd {Zobs.std():.4f}  업체 {s.sum():,}")
rsel=np.flatnonzero(keepR)
rng=np.random.default_rng(31)
def null(shared,B=200):
    sds=np.empty(B)
    for b in range(B):
        if shared:
            ug=rng.random(len(uR)); u=ug[gR[rsel]]
        else:
            u=rng.random(len(rsel))
        pos=np.searchsorted(K,rsel+u,side='left')
        pos=np.clip(pos,0,len(K)-1)
        Ap=np.bincount(ivk[pos],minlength=nb).astype(float)
        sds[b]=((Ap[s]-E[s])/np.sqrt(V[s])).std()
    return sds
a=null(False); b_=null(True)
print(f"독립 R 추첨 null      sd(z) {a.mean():.4f}±{a.std():.4f}   -> 관측 z={(Zobs.std()-a.mean())/a.std():+.1f}")
print(f"R 공유그룹 블록 null  sd(z) {b_.mean():.4f}±{b_.std():.4f}   -> 관측 z={(Zobs.std()-b_.mean())/b_.std():+.1f}")
