"""모듈 책임: 투찰률 분포와 위험집합 정의에 따른 낙찰 규칙 일치율을 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; wd=D['wd']; R=D['R']; Rs=D['R_suspect']
print("x 분위:",np.round(np.percentile(x,[0,0.01,0.1,1,5,25,50,75,95,99,99.9,99.99,100]),5).tolist())
print("x in [0.9,1.05] 비율", ((x>=0.9)&(x<=1.05)).mean())
print("R 고유값 수",len(np.unique(np.round(R,8))))
Rok=R[~Rs]; print("R 분위:",np.round(np.percentile(Rok,[0,0.1,1,5,25,50,75,95,99,99.9,100]),6).tolist())
# 규칙 검증: 낙찰자는 R 이상 최저 x 인가
wi=np.flatnonzero(win); wr=rounds[wi]
assert np.all(np.diff(wr)>0) or len(np.unique(wr))==nR
xw=np.zeros(nR); xw[rounds[wi]]=x[wi]
Rr=R[rounds]
elig=(x>=Rr)
# 회차별 최소 적격 x
BIG=1e18
xe=np.where(elig,x,BIG)
order=np.lexsort((xe,rounds))
# 회차별 첫 원소가 최소
startpos=np.concatenate([[0],np.cumsum(off)[:-1]])
minelig=xe[order[startpos]]
agree=np.isclose(minelig,xw,rtol=1e-6)
print(f"\n'낙찰자 = R 이상 최저 x' 일치 회차 {agree.sum():,}/{nR:,} = {agree.mean()*100:.2f}%")
nofeas=(minelig>=BIG)
print(f"적격 투찰이 하나도 없는 회차 {int(nofeas.sum()):,}")
print(f"비일치 회차 중 R_suspect {int((Rs&~agree).sum()):,}")
ag2=agree[~Rs]; print(f"R_suspect 제외 일치율 {ag2.mean()*100:.3f}%  (회차 {len(ag2):,})")
# 낙찰자가 철회로 표시된 회차
wdw=np.zeros(nR,bool); wdw[rounds[win&wd]]=True
print(f"낙찰자가 wd=True 인 회차 {int(wdw.sum()):,}  그중 규칙일치 {agree[wdw].mean()*100:.2f}%")
print(f"낙찰자 wd=False 회차 규칙일치 {agree[~wdw].mean()*100:.2f}%")
