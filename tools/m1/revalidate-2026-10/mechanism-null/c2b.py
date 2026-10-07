"""모듈 책임: 1기 z 5분위별 2기 성과와 투찰률 선택 습관의 지속성을 1/N·메커니즘 기준으로 나란히 낸다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
from scipy.stats import spearmanr, rankdata
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
win=D['is_recorded_winner']; wd=D['wd']; biz=D['biz_no']; Rs=D['R_suspect']; ym=D['ym']
x=D['x'].astype(np.float64); pm=np.load('pm.npy')
ub,inv=np.unique(biz,return_inverse=True); nb=len(ub)
live=~wd; Nl=np.bincount(rounds[live],minlength=nR)
okc=live&(~Rs[rounds])&(Nl[rounds]>0); pc=np.where(okc,1.0/np.maximum(Nl[rounds],1),0.0)
P1=ym[rounds]<=202512; P2=ym[rounds]>=202601
def agg(p,mask):
    f=lambda w: np.bincount(inv[mask],weights=w,minlength=nb)
    return f(p[mask]),f((p*(1-p))[mask]),f(win[mask].astype(float)),np.bincount(inv[mask],minlength=nb)
E1,V1,A1,C1=agg(pc,okc&P1); E2,V2,A2,C2=agg(pc,okc&P2)
s=(C1>=100)&(C2>=50)&(V1>0)&(V2>0)
z1=(A1[s]-E1[s])/np.sqrt(V1[s]); z2=(A2[s]-E2[s])/np.sqrt(V2[s])
# 업체-기간별 전략 지표: 평균 메커니즘 승률(= x 선택의 질), 평균 x, 평균 1/N
def mean_of(v,mask):
    c=np.bincount(inv[mask],minlength=nb); t=np.bincount(inv[mask],weights=v[mask],minlength=nb)
    return np.divide(t,c,out=np.zeros(nb),where=c>0)
q1=mean_of(pm,okc&P1)[s]; q2=mean_of(pm,okc&P2)[s]
n1=mean_of(1.0/off[rounds],okc&P1)[s]; n2=mean_of(1.0/off[rounds],okc&P2)[s]
xm1=mean_of(x,okc&P1)[s]; xm2=mean_of(x,okc&P2)[s]
print(f"업체 {s.sum():,}")
print(f"'x 선택의 질' q=평균 p_mech 의 기간간 지속성       rho={spearmanr(q1,q2).statistic:+.4f}")
print(f"평균 x 의 기간간 지속성                             rho={spearmanr(xm1,xm2).statistic:+.4f}")
print(f"평균 1/N(참여환경) 의 기간간 지속성                 rho={spearmanr(n1,n2).statistic:+.4f}")
print(f"z1 vs q1/n1 비율(= 1/N 기준 초과 승률의 구조적 몫)  rho={spearmanr(z1,q1/n1).statistic:+.4f}")
print(f"z2 vs q2/n2                                        rho={spearmanr(z2,q2/n2).statistic:+.4f}")
# 부분 Spearman: 관측 통제변수 제거
def partial(a,b,ctrl):
    ra=rankdata(a); rb=rankdata(b)
    X=np.column_stack([np.ones(len(ra))]+[rankdata(c) for c in ctrl])
    pa=ra-X@np.linalg.lstsq(X,ra,rcond=None)[0]; pb=rb-X@np.linalg.lstsq(X,rb,rcond=None)[0]
    return np.corrcoef(pa,pb)[0,1]
print(f"\n부분상관 (순위 회귀로 통제):")
print(f"  통제 없음                           {partial(z1,z2,[]):+.4f}")
print(f"  볼륨 C1,C2                          {partial(z1,z2,[C1[s],C2[s]]):+.4f}")
print(f"  참여환경 n1,n2 (N 대역)             {partial(z1,z2,[n1,n2]):+.4f}")
print(f"  + 평균 x                            {partial(z1,z2,[n1,n2,xm1,xm2]):+.4f}")
print(f"  + 메커니즘 승률 q1,q2 (x 선택 전부) {partial(z1,z2,[n1,n2,q1,q2]):+.4f}")
print(f"  볼륨+환경+q 전부                    {partial(z1,z2,[C1[s],C2[s],n1,n2,q1,q2]):+.4f}")
# 품목 구성 통제 추가
it=D['item']
itm=[mean_of((it[rounds]==k).astype(float),okc&P1)[s] for k in range(10)]
print(f"  + 품목구성 10개                     {partial(z1,z2,[n1,n2,q1,q2]+itm):+.4f}")
# 예측 검정: 1기 z1 분위별 2기 실제/기대
zm=np.load('c2.npz'); 
print(f"\n=== 1기 z1(주장 기준) 5분위별 2기 성과 ===")
qt=np.quantile(z1,[.2,.4,.6,.8]); g=np.digitize(z1,qt)
for k in range(5):
    m=g==k
    print(f"  Q{k+1} 업체{m.sum():>4}  2기 실제낙찰 {A2[s][m].sum():>6.0f}  1/N기대 {E2[s][m].sum():>8.1f} (비 {A2[s][m].sum()/E2[s][m].sum():.3f})")
# 메커니즘 기대
Em2,Vm2,Am2,Cm2=agg(pm,(~Rs[rounds])&P2)
for k in range(5):
    m=g==k; idx=np.flatnonzero(s)[m]
    print(f"  Q{k+1} 메커니즘기대 {Em2[idx].sum():>8.1f}  실제 {Am2[idx].sum():>6.0f}  비 {Am2[idx].sum()/Em2[idx].sum():.3f}")
