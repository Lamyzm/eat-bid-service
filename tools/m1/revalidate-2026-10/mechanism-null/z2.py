"""모듈 책임: 실력이 0이고 R만 다시 추첨할 때 1/N z와 메커니즘 z의 귀무 sd를 모수적 부트스트랩으로 만든다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; wd=D['wd']
pm=np.load('pm.npy')
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
ok=(~Rs[rounds])&(pm>=0)        # 전체 투찰 = 경쟁자 (wd 포함)
def zstat(p,mask,thr=100):
    E=np.bincount(inv[mask],weights=p[mask],minlength=nb)
    V=np.bincount(inv[mask],weights=(p*(1-p))[mask],minlength=nb)
    A=np.bincount(inv[mask],weights=win[mask].astype(float),minlength=nb)
    C=np.bincount(inv[mask],minlength=nb)
    s=(C>=thr)&(V>0)
    return (A[s]-E[s])/np.sqrt(V[s]),s,E,V,A,C
# (a) 1/N, wd 포함 (올바른 위험집합 + 1/N)
pN=np.where(ok,1.0/off[rounds],0.0)
Za,sa,_,_,_,_=zstat(pN,ok)
# (b) 메커니즘 null
Zb,sb,Eb,Vb,Ab,Cb=zstat(pm,ok)
print(f"(a) 1/N  (wd 포함, 전체 투찰)   업체 {sa.sum():,}  mean {Za.mean():+.4f}  sd {Za.std():.4f}")
print(f"(b) 메커니즘 P(R∈(x_prev,x])    업체 {sb.sum():,}  mean {Zb.mean():+.4f}  sd {Zb.std():.4f}")
np.savez('zc.npz',Zb=Zb,sb=sb,Eb=Eb,Vb=Vb,Ab=Ab,Cb=Cb)
# 순열 null: p_mech 분포로 회차별 낙찰자 추첨
okidx=np.flatnonzero(ok); ro=rounds[okidx]; po=pm[okidx]; ivo=inv[okidx]
cnt=np.bincount(ro,minlength=nR); start=np.concatenate([[0],np.cumsum(cnt)[:-1]])
csum=np.cumsum(po); base_=np.concatenate([[0.0],csum[np.cumsum(cnt)-1]])[:-1]
# 회차별 누적 (정규화됐으니 각 회차 합=1)
tot=np.bincount(ro,weights=po,minlength=nR)
rsel=np.flatnonzero((cnt>0)&(tot>0.999))
rng=np.random.default_rng(11)
def permsd(pfit,B=200):
    sds=np.empty(B)
    for b in range(B):
        u=rng.random(len(rsel))*tot[rsel]+base_[rsel]
        pos=np.searchsorted(csum,u,side='left')
        Ap=np.bincount(ivo[pos],minlength=nb).astype(float)
        Ep=np.bincount(ivo,weights=pfit,minlength=nb); Vp=np.bincount(ivo,weights=pfit*(1-pfit),minlength=nb)
        Cp=np.bincount(ivo,minlength=nb); s=(Cp>=100)&(Vp>0)
        sds[b]=((Ap[s]-Ep[s])/np.sqrt(Vp[s])).std()
    return sds
s_mech=permsd(po)
print(f"\n메커니즘 순열 null 하에서 sd(z_mech): 평균 {s_mech.mean():.4f} sd {s_mech.std():.4f} 범위[{s_mech.min():.4f},{s_mech.max():.4f}]")
# 같은 순열 데이터를 1/N 추정량으로 평가하면? -> 1/N null 의 sd 가 얼마나 부풀려지는지
pNo=pN[okidx]
sds=np.empty(200)
for b in range(200):
    u=rng.random(len(rsel))*tot[rsel]+base_[rsel]
    pos=np.searchsorted(csum,u,side='left')
    Ap=np.bincount(ivo[pos],minlength=nb).astype(float)
    Ep=np.bincount(ivo,weights=pNo,minlength=nb); Vp=np.bincount(ivo,weights=pNo*(1-pNo),minlength=nb)
    Cp=np.bincount(ivo,minlength=nb); s=(Cp>=100)&(Vp>0)
    sds[b]=((Ap[s]-Ep[s])/np.sqrt(Vp[s])).std()
print(f"실력이 전혀 없고 x 선택만 그대로일 때 1/N 추정량의 sd(z): 평균 {sds.mean():.4f} sd {sds.std():.4f} 범위[{sds.min():.4f},{sds.max():.4f}]")
print(f"  <- 주장 1 의 관측값 2.4859 와 비교")
