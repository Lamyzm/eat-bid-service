"""모듈 책임: 투찰마다 메커니즘 낙찰확률 F_R(x)-F_R(x_prev)를 계산하고 회차 합과 확률 대역별 보정을 확인한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; R=D['R']; Rs=D['R_suspect']
Rc=np.sort(R[~Rs]); m=len(Rc)
def F(v): return np.searchsorted(Rc,v,side='right')/m   # P(R<=v)
# 회차 내 x 정렬
o=np.lexsort((x,rounds)); xs=x[o]; rs=rounds[o]
newround=np.empty(len(xs),bool); newround[0]=True; newround[1:]=rs[1:]!=rs[:-1]
# 직전 서로 다른 x (같은 회차 내). 동점이면 같은 구간 공유
prev=np.empty(len(xs)); prev[0]=-1.0; prev[1:]=xs[:-1]
prev[newround]=-1.0
# 동점 처리: 각 (round, x) 그룹의 그룹 시작 위치의 prev 가 그룹의 하한
grpstart=newround|(xs!=prev)
gid=np.cumsum(grpstart)-1
lower=prev[grpstart]            # 그룹별 하한
gsz=np.bincount(gid)
Fhi=F(xs[grpstart]); Flo=np.where(lower<0,0.0,F(lower))
pg=np.maximum(Fhi-Flo,0.0)
p_sorted=(pg/gsz)[gid]
# 회차별 정규화 (정확히 한 명 낙찰에 조건부)
S=np.bincount(rs,weights=p_sorted,minlength=nR)
print("회차별 p 합 분위:",np.round(np.percentile(S,[0.1,1,25,50,75,99,100]),4).tolist())
print("합=0 회차",int((S<=0).sum()))
p_mech=np.empty(len(xs)); good=S[rs]>0
p_mech[good]=p_sorted[good]/S[rs][good]; p_mech[~good]=0.0
# 원래 순서로 복원
pm=np.empty(len(x)); pm[o]=p_mech
np.save('pm.npy',pm)
# 보정: 예측 승률 신뢰도 점검
bins=np.array([0,.001,.005,.02,.05,.1,.2,.4,.7,1.01])
ix=np.digitize(pm,bins)-1
print("\n예측 p vs 실제 낙찰률 (신뢰도):")
for k in range(len(bins)-1):
    s=ix==k
    if s.sum()>0: print(f"  p∈[{bins[k]:.3f},{bins[k+1]:.3f}) n={s.sum():>9,}  예측 {pm[s].mean():.4f}  실제 {win[s].mean():.4f}")
print(f"\n전체: 예측합 {pm.sum():.0f}  실제 낙찰 {win.sum():,}")
# 1/N 과 비교
Nn=off[rounds]; pN=1.0/Nn
print(f"1/N 과 p_mech 의 상관 (N>=10): ", np.corrcoef(pN[Nn>=10],pm[Nn>=10])[0,1].round(4))
