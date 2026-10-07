"""모듈 책임: 회차-업체 쌍의 중복 투찰 여부를 확인한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; wd=D['wd']; biz=D['biz_no']; Rs=D['R_suspect']
live=~wd
Nl=np.bincount(rounds[live],minlength=nR)
ok=live&(~Rs[rounds])&(Nl[rounds]>0)
p=np.where(ok,1.0/np.maximum(Nl[rounds],1),0.0)
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
E=np.bincount(inv[ok],weights=p[ok],minlength=nb)
V=np.bincount(inv[ok],weights=(p*(1-p))[ok],minlength=nb)
A=np.bincount(inv[ok],weights=win[ok].astype(float),minlength=nb)
C=np.bincount(inv[ok],minlength=nb)
sel=C>=100; nsel=int(sel.sum())

# 같은 회차에 같은 업체 중복 투찰?
key=rounds[ok].astype(np.int64)*nb+inv[ok]
u,cc=np.unique(key,return_counts=True)
print(f"회차-업체 쌍 {len(u):,} / 포함 투찰 {ok.sum():,}  중복(2건 이상) 쌍 {int((cc>1).sum()):,}  최대 {cc.max()}")
print(f"중복에 속한 투찰 비율 {(cc[cc>1].sum())/ok.sum():.4f}")

# 순열 null: 각 포함 회차에서 live 중 균등하게 1명 낙찰
okidx=np.flatnonzero(ok)
ro=rounds[okidx]
# ro는 정렬돼 있음 (rounds 자체가 정렬)
assert np.all(np.diff(ro)>=0)
cnt=np.bincount(ro,minlength=nR)
start=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rsel=np.flatnonzero(cnt>0)   # 포함 회차
invok=inv[okidx]
# 관측 z
Zobs=(A[sel]-E[sel])/np.sqrt(np.maximum(V[sel],1e-9))
print(f"\n관측  sd(z)={Zobs.std():.4f}  mean={Zobs.mean():+.4f}")

rng=np.random.default_rng(7)
B=300
sds=np.empty(B); mns=np.empty(B); sd_c=np.empty(B)
# 보정판: 낙찰자가 ok 안에 있는 회차만 사용
winround=np.zeros(nR,bool); winround[rounds[win&ok]]=True
keep=winround[rounds]&ok
pc=np.where(keep,1.0/np.maximum(Nl[rounds],1),0.0)
Ec=np.bincount(inv[keep],weights=pc[keep],minlength=nb)
Vc=np.bincount(inv[keep],weights=(pc*(1-pc))[keep],minlength=nb)
Ac=np.bincount(inv[keep],weights=win[keep].astype(float),minlength=nb)
Cc=np.bincount(inv[keep],minlength=nb)
selc=Cc>=100
Zc=(Ac[selc]-Ec[selc])/np.sqrt(np.maximum(Vc[selc],1e-9))
print(f"보정(결손회차 제외)  업체 {int(selc.sum()):,}  sd(z)={Zc.std():.4f}  mean={Zc.mean():+.4f}")
print(f"  SUM Ec={Ec.sum():.1f} SUM Ac={Ac.sum():.0f}")

# 순열 (원래 추정량 그대로)
for b in range(B):
    u01=rng.random(len(rsel))
    pickpos=start[rsel]+ (u01*cnt[rsel]).astype(np.int64)
    Ap=np.bincount(invok[pickpos],minlength=nb).astype(float)
    Zp=(Ap[sel]-E[sel])/np.sqrt(np.maximum(V[sel],1e-9))
    sds[b]=Zp.std(); mns[b]=Zp.mean()
print(f"\n순열 null (원 추정량, 전 포함회차에서 1명 낙찰):")
print(f"  sd(z) 평균 {sds.mean():.4f}  sd {sds.std():.4f}  범위 [{sds.min():.4f},{sds.max():.4f}]")
print(f"  mean(z) 평균 {mns.mean():+.4f}")
np.savez('perm_cache.npz',E=E,V=V,A=A,C=C,sel=sel,Ec=Ec,Vc=Vc,Ac=Ac,Cc=Cc,selc=selc)
