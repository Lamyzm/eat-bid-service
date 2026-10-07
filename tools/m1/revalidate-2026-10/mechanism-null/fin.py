"""모듈 책임: 지속 초과분산과 낙찰 분산 중 실력 몫 같은 보정 효과크기를 낸다."""
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
E=np.bincount(inv[ok],weights=pm[ok],minlength=nb); C=np.bincount(inv[ok],minlength=nb)
s=(C>=50)&(E>0)
rho_sh=0.0289
v=rho_sh/(1-rho_sh)
mE=E[s].mean()
theta=np.sqrt(v/mE)
print(f"업체 {s.sum():,}  평균 기대낙찰 E {mE:.1f}")
print(f"분할반분 rho={rho_sh:.4f} -> 지속되는 업체 수준 초과분산 v={v:.4f}")
print(f"  (주장1이 말한 초과분산 2.49^2-1 = {2.49**2-1:.2f})  ->  주장 대비 {v/(2.49**2-1)*100:.2f}%")
print(f"지속되는 상대우위 sd(theta) = {theta:.4f}  (= 승률을 {theta*100:.1f}% 상대적으로 올리거나 내림)")
pbar=pm[ok].mean()
print(f"평균 낙찰확률 {pbar:.5f} -> 상위/하위 1sd 업체의 승률 {pbar*(1+theta):.5f} / {pbar*(1-theta):.5f}")
print(f"'실력' 으로 설명되는 낙찰 분산 비중: {v/(1+v)*100:.2f}%  (주장: {(2.49**2-1)/2.49**2*100:.1f}%)")
