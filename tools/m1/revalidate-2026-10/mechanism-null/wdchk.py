"""모듈 책임: 철회 투찰도 경쟁하고 차단하는지 규칙 일치율로 확인한다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; wd=D['wd']; R=D['R']; Rs=D['R_suspect']
xw=np.zeros(nR); xw[rounds[win]]=x[win]
Rr=R[rounds]; startpos=np.concatenate([[0],np.cumsum(off)[:-1]])
def agree_with(mask):
    xe=np.where((x>=Rr)&mask,x,1e18)
    o=np.lexsort((xe,rounds)); m=xe[o[startpos]]
    return np.isclose(m,xw,rtol=1e-6)
a_all=agree_with(np.ones(len(x),bool))
a_live=agree_with(~wd)
print(f"전체 투찰을 경쟁자로 볼 때 규칙 일치율 {a_all.mean()*100:.3f}%")
print(f"wd 제외(=철회는 경쟁 안 함)로 볼 때 일치율 {a_live.mean()*100:.3f}%")
# 비낙찰 wd 투찰이 R과 낙찰가 사이를 막는 사례 수
block=(~win)&wd&(x>=Rr)&(x<xw[rounds])
print(f"비낙찰 wd 투찰이 [R, 낙찰가) 구간에 있는 건수 {int(block.sum()):,}  (경쟁 안 했다면 0이어야 하지만 경쟁했다면 0)")
print(f"비낙찰 live 투찰이 [R, 낙찰가) 구간에 있는 건수 {int(((~win)&(~wd)&(x>=Rr)&(x<xw[rounds])).sum()):,}")
# 철회율의 업체 간 분산
biz=D['biz_no']; ub,inv=np.unique(biz,return_inverse=True)
C=np.bincount(inv,minlength=len(ub)); W=np.bincount(inv,weights=wd.astype(float),minlength=len(ub))
s=C>=100; wr=W[s]/C[s]
print(f"\n업체별 철회율 (100건+ {s.sum():,}개): 평균 {wr.mean():.3f} sd {wr.std():.3f} 분위 {np.round(np.percentile(wr,[1,25,50,75,99]),3).tolist()}")
