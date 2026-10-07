"""모듈 책임: 동점 투찰과 동점 그룹 낙찰이 초과분산에 기여하는지 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; Rs=D['R_suspect']; R=D['R']; rnk=D['rnk']
pm=np.load('pm.npy')
o=np.lexsort((x,rounds)); xs=x[o]; rs=rounds[o]
nw=np.empty(len(xs),bool); nw[0]=True; nw[1:]=rs[1:]!=rs[:-1]
prev=np.empty(len(xs)); prev[0]=-1; prev[1:]=xs[:-1]; prev[nw]=-1
gstart=nw|(xs!=prev); gid=np.cumsum(gstart)-1; gsz=np.bincount(gid)
tied=(gsz[gid]>1)
t=np.empty(len(x),bool); t[o]=tied
print(f"동점(같은 회차 같은 x) 투찰 비율 {t.mean():.4f}")
print(f"낙찰 중 동점그룹 소속 비율 {t[win].mean():.4f}")
print(f"동점그룹이 보유한 예측 승률 질량 {pm[t].sum()/pm.sum():.4f}")
# 동점그룹 안에서 승자 선택이 균등한가? rnk 를 이용
# rnk = eaT 순위. 동점 2인 그룹에서 rnk 작은 쪽이 이기는지
gs=np.cumsum(gstart)-1
idx2=np.flatnonzero(gsz==2)
# 각 2인 그룹의 두 멤버
pos=np.flatnonzero(gstart); 
sel2=pos[gsz==2]
a=o[sel2]; b=o[sel2+1]
hw=win[a]|win[b]
print(f"\n2인 동점그룹 {len(a):,}  그 중 한쪽이 낙찰한 그룹 {hw.sum():,}")
m=hw
ra,rb=rnk[a][m],rnk[b][m]
first_win=win[a][m]
print(f"  rnk 더 작은 쪽이 낙찰한 비율 {np.mean(np.where(ra<rb,first_win,~first_win)):.4f} (균등이면 0.5)")
