"""모듈 책임: 업체별 1/N z 분포 sd 2.49와 기준선 항등식의 전역 결손을 재현한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; wd=D['wd']; biz=D['biz_no']; Rs=D['R_suspect']
live=~wd
Nl=np.bincount(rounds[live],minlength=nR)
ok=live&(~Rs[rounds])&(Nl[rounds]>0)
p=np.where(ok,1.0/np.maximum(Nl[rounds],1),0.0)
ub,inv=np.unique(biz,return_inverse=True)
nb=len(ub)
E=np.bincount(inv[ok],weights=p[ok],minlength=nb)
V=np.bincount(inv[ok],weights=(p*(1-p))[ok],minlength=nb)
A=np.bincount(inv[ok],weights=win[ok].astype(float),minlength=nb)
C=np.bincount(inv[ok],minlength=nb)
sel=C>=100
Z=(A[sel]-E[sel])/np.sqrt(np.maximum(V[sel],1e-9))
print(f"재현: 업체 {sel.sum():,}  z mean {Z.mean():+.4f}  sd {Z.std():.4f}  (주장 sd=2.49)")
print("--- 항등식 점검 ---")
print(f"포함 투찰 수 {ok.sum():,} / 전체 {len(win):,}")
print(f"SUM E = {E.sum():.1f}   SUM A(실제 낙찰, 포함분만) = {A.sum():.0f}   차이 {A.sum()-E.sum():+.1f}")
nr_ok=np.unique(rounds[ok]); print(f"포함된 회차 수 {len(nr_ok):,}")
# 포함 회차 중 낙찰자가 ok 마스크 밖(=철회)인 회차
wr=rounds[win]; 
inc_round=np.zeros(nR,bool); inc_round[nr_ok]=True
win_ok_round=np.zeros(nR,bool); win_ok_round[rounds[win&ok]]=True
print(f"포함 회차인데 낙찰자가 제외된 회차: {int((inc_round&~win_ok_round).sum()):,}")
print(f"  -> 전역 결손율 {1-A.sum()/E.sum():.4f}")
np.save('inv.npy',inv); np.save('ok.npy',ok); np.save('p.npy',p); np.save('Nl.npy',Nl); np.save('rounds.npy',rounds)
