"""모듈 책임: 하한율 고유값 분포와 하한율 90 비중을 확인한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
R=D['R']; Rs=D['R_suspect']; yr=D['year']; it=D['item']; fl=D['floor']
print("floor 고유값(상위):",np.unique(np.round(fl,3))[:12],"... 개수",len(np.unique(np.round(fl,3))))
print("floor==90 비율",(np.round(fl,3)==90.0).mean())
# R 의 회차 간 이질성: 연·품목·floor 대역별 R 평균/표준편차
flb=np.digitize(fl,[85,88,89.5,89.99])
key=(yr.astype(np.int64)-2023)*1000+it.astype(np.int64)*10+flb
u,ki=np.unique(key[~Rs],return_inverse=True)
Rg=R[~Rs]
print(f"\n층 수 {len(u)}")
mu=np.bincount(ki,weights=Rg,minlength=len(u))/np.bincount(ki,minlength=len(u))
sd=np.sqrt(np.bincount(ki,weights=Rg**2,minlength=len(u))/np.bincount(ki,minlength=len(u))-mu**2)
n=np.bincount(ki,minlength=len(u))
print("층별 R 평균 분위:",np.round(np.percentile(np.repeat(mu,n),[1,25,50,75,99]),5).tolist())
print("층별 R sd  분위:",np.round(np.percentile(np.repeat(sd,n),[1,25,50,75,99]),5).tolist())
print("전체 R sd",Rg.std().round(5))
print("층 간 분산 비중(ICC):",(np.repeat(mu,n).var()/Rg.var()).round(4))
