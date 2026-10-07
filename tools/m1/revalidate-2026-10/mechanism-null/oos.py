"""모듈 책임: 고정 투찰률 x0를 학습기에서 고르고 2026년 검증기에 적용해 표본 밖 배수를 낸다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); Rs=D['R_suspect']; R=D['R']; ym=D['ym']
xc=np.clip(x,0.0,1.9); key=rounds*2.0+xc
o=np.argsort(key,kind='stable'); ks=key[o]; xsrt=xc[o]; rsrt=rounds[o]
sp=np.concatenate([[0],np.cumsum(off)[:-1]])
def winrate(rsel,x0):
    idx=np.searchsorted(ks,rsel*2.0+x0,side='left')-1
    ci=np.clip(idx,0,len(ks)-1); same=(idx>=0)&(rsrt[ci]==rsel)
    g=np.where(same,xsrt[ci],0.0)
    return ((R[rsel]>g)&(R[rsel]<=x0)).mean()
grid=np.arange(0.978,1.0301,0.001)
for lab,msk in [("학습 ym<=202512",(off>=40)&(off<=70)&(~Rs)&(ym<=202512)),
                ("검증 ym>=202601",(off>=40)&(off<=70)&(~Rs)&(ym>=202601))]:
    rs=np.flatnonzero(msk); b=np.mean(1.0/off[rs])
    wr=np.array([winrate(rs,g) for g in grid])
    k=np.argmax(wr)
    print(f"{lab}: 회차 {len(rs):,} 기준 {b:.5f}  최적 x0={grid[k]:.3f} 배수 {wr[k]/b:.3f}")
    globals()['wr_'+('tr' if 'ym<=' in lab else 'te')]=wr; globals()['b_'+('tr' if 'ym<=' in lab else 'te')]=b; globals()['rs_'+('tr' if 'ym<=' in lab else 'te')]=rs
ktr=np.argmax(wr_tr)
print(f"\n학습기 최적 x0={grid[ktr]:.3f} 을 검증기에 적용: 배수 {wr_te[ktr]/b_te:.3f}  (검증기 자체최적 {wr_te.max()/b_te:.3f})")
print("검증기 배수 곡선 (x0 0.980~1.000):")
print("  "+"  ".join(f"{grid[i]:.3f}:{wr_te[i]/b_te:.2f}" for i in range(len(grid)) if 0.9795<grid[i]<1.0005))
