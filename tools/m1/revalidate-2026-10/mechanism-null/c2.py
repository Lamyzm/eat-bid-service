"""모듈 책임: 기간 간 업체 지속성을 1/N 기준과 메커니즘 기준으로 재현·비교한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
from scipy.stats import spearmanr
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; wd=D['wd']; biz=D['biz_no']; Rs=D['R_suspect']; ym=D['ym']
x=D['x'].astype(np.float64)
pm=np.load('pm.npy')
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
live=~wd; Nl=np.bincount(rounds[live],minlength=nR)
ok_claim=live&(~Rs[rounds])&(Nl[rounds]>0)
p_claim=np.where(ok_claim,1.0/np.maximum(Nl[rounds],1),0.0)
P1=ym[rounds]<=202512; P2=ym[rounds]>=202601
def agg(p,mask):
    E=np.bincount(inv[mask],weights=p[mask],minlength=nb)
    V=np.bincount(inv[mask],weights=(p*(1-p))[mask],minlength=nb)
    A=np.bincount(inv[mask],weights=win[mask].astype(float),minlength=nb)
    C=np.bincount(inv[mask],minlength=nb)
    return E,V,A,C
def rho_of(p,okm,lab):
    E1,V1,A1,C1=agg(p,okm&P1); E2,V2,A2,C2=agg(p,okm&P2)
    s=(C1>=100)&(C2>=50)&(V1>0)&(V2>0)
    z1=(A1[s]-E1[s])/np.sqrt(V1[s]); z2=(A2[s]-E2[s])/np.sqrt(V2[s])
    r,pv=spearmanr(z1,z2)
    print(f"{lab}: 업체 {s.sum():,}  rho={r:+.4f}  p={pv:.2e}")
    return z1,z2,s,E1,E2,V1,V2,A1,A2,C1,C2
print("=== 1) 재현 ===")
z1,z2,s,E1,E2,V1,V2,A1,A2,C1,C2=rho_of(p_claim,ok_claim,"주장2 그대로(1/N, wd제외)")
# 볼륨 지속성이 만드는 가짜 상관
print(f"\n기대낙찰 E1,E2 의 Spearman rho = {spearmanr(E1[s],E2[s]).statistic:+.4f}  (환경/볼륨 지속성)")
print(f"z1 vs sqrt(E1) rho = {spearmanr(z1,np.sqrt(E1[s])).statistic:+.4f}   z2 vs sqrt(E2) rho = {spearmanr(z2,np.sqrt(E2[s])).statistic:+.4f}")
# 결손편향만으로 기대되는 rho: A|null = Binom with p*(1-delta)
d1=1-A1[s].sum()/E1[s].sum(); d2=1-A2[s].sum()/E2[s].sum()
print(f"기간별 전역 결손율 delta1={d1:.4f} delta2={d2:.4f}")
rng=np.random.default_rng(5)
# 순열 null 하에서의 rho: 각 기간 각 회차에서 live 중 균등 추첨 (실력 0)
def perm_rho(p,okm,B=100):
    mi=np.flatnonzero(okm); ro=rounds[mi]; ivo=inv[mi]; po=p[mi]
    per=np.where(P1[ro],0,1)
    cnt=np.bincount(ro,minlength=nR); start=np.concatenate([[0],np.cumsum(cnt)[:-1]])
    rsel=np.flatnonzero(cnt>0)
    # 기간별 E,V,C 고정
    out=np.empty(B)
    EE=[np.bincount(ivo[per==k],weights=po[per==k],minlength=nb) for k in (0,1)]
    VV=[np.bincount(ivo[per==k],weights=(po*(1-po))[per==k],minlength=nb) for k in (0,1)]
    CC=[np.bincount(ivo[per==k],minlength=nb) for k in (0,1)]
    ss=(CC[0]>=100)&(CC[1]>=50)&(VV[0]>0)&(VV[1]>0)
    rp=np.where(P1[rsel],0,1)
    for b in range(B):
        u=rng.random(len(rsel))
        pos=start[rsel]+(u*cnt[rsel]).astype(np.int64)
        wb=ivo[pos]
        A0=np.bincount(wb[rp==0],minlength=nb).astype(float); A1_=np.bincount(wb[rp==1],minlength=nb).astype(float)
        zz1=(A0[ss]-EE[0][ss])/np.sqrt(VV[0][ss]); zz2=(A1_[ss]-EE[1][ss])/np.sqrt(VV[1][ss])
        out[b]=spearmanr(zz1,zz2).statistic
    return out,int(ss.sum())
pr,nss=perm_rho(p_claim,ok_claim)
print(f"\n실력 0 순열 null(1/N, 결손 없음): rho 평균 {pr.mean():+.4f} sd {pr.std():.4f} 범위[{pr.min():+.4f},{pr.max():+.4f}] 업체{nss:,}")
print("\n=== 2) 올바른 위험집합 + 메커니즘 null ===")
ok_full=(~Rs[rounds])
rho_of(np.where(ok_full,1.0/off[rounds],0.0),ok_full,"1/N (wd 포함)")
zm1,zm2,sm,*_=rho_of(pm,ok_full,"메커니즘 null z")
np.savez('c2.npz',zm1=zm1,zm2=zm2,sm=sm)
