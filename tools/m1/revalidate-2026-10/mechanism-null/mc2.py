"""모듈 책임: 최소 투찰 건수 임계값 격자에서 1/N sd와 메커니즘 sd의 변화를 비교한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
from scipy.stats import spearmanr
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; biz=D['biz_no']; Rs=D['R_suspect']; ym=D['ym']; wd=D['wd']
pm=np.load('pm.npy'); ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
ok=(~Rs[rounds]); live=~wd; Nl=np.bincount(rounds[live],minlength=nR)
okc=live&ok&(Nl[rounds]>0); pc=np.where(okc,1.0/np.maximum(Nl[rounds],1),0.0)
def z(p,mask,thr):
    f=lambda w: np.bincount(inv[mask],weights=w,minlength=nb)
    E=f(p[mask]); V=f((p*(1-p))[mask]); A=f(win[mask].astype(float)); C=np.bincount(inv[mask],minlength=nb)
    s=(C>=thr)&(V>0); return (A[s]-E[s])/np.sqrt(V[s]),s
print("=== 주장1 가족: 최소투찰건수 임계값 격자 ===")
print("thr   1/N·wd제외 sd   1/N·전체 sd   메커니즘 sd   업체수")
for thr in [30,50,100,200,500,1000]:
    Za,_=z(pc,okc,thr); Zb,_=z(np.where(ok,1.0/off[rounds],0.0),ok,thr); Zc,s=z(pm,ok,thr)
    print(f"{thr:>4}  {Za.std():>13.4f}  {Zb.std():>12.4f}  {Zc.std():>12.4f}  {s.sum():>6,}")
print("\n=== 주장2 가족: 분할시점 x 임계값 격자 (메커니즘 null z 의 rho) ===")
splits=[202503,202506,202509,202512,202603]
print("split  thr  rho(1/N·wd제외)  rho(메커니즘)  업체")
res=[]
for sp_ in splits:
    P1=ym[rounds]<=sp_; P2=ym[rounds]>sp_
    for thr1,thr2 in [(100,50),(50,30),(200,100)]:
        def pair(p,okm):
            f=lambda m,w: np.bincount(inv[m],weights=w[m],minlength=nb)
            m1=okm&P1; m2=okm&P2
            E1=f(m1,p);V1=f(m1,p*(1-p));A1=f(m1,win.astype(float));C1=np.bincount(inv[m1],minlength=nb)
            E2=f(m2,p);V2=f(m2,p*(1-p));A2=f(m2,win.astype(float));C2=np.bincount(inv[m2],minlength=nb)
            s=(C1>=thr1)&(C2>=thr2)&(V1>0)&(V2>0)
            return (A1[s]-E1[s])/np.sqrt(V1[s]),(A2[s]-E2[s])/np.sqrt(V2[s]),s
        a1,a2,sa=pair(pc,okc); b1,b2,sb=pair(pm,ok)
        r1=spearmanr(a1,a2).statistic; r2=spearmanr(b1,b2).statistic
        res.append(r2)
        print(f"{sp_}  {thr1:>3}  {r1:+.4f}          {r2:+.4f}       {sb.sum():,}")
res=np.array(res)
print(f"\n메커니즘 null 하 rho 15칸: 최대 {res.max():+.4f} 최소 {res.min():+.4f}  |rho| 평균 {np.abs(res).mean():.4f}")
print(f"업체수 ~2000 에서 rho 의 null sd ≈ {1/np.sqrt(2000):.4f}  -> 15회 검정 Bonferroni 임계 |rho|>{2.94/np.sqrt(2000):.4f}")
print(f"-> 15칸 중 Bonferroni 통과 {int((np.abs(res)>2.94/np.sqrt(2000)).sum())}개")
