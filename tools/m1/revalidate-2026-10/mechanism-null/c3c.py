"""모듈 책임: 고정 투찰률을 쓸 때 실제로 떨어지는 회차 내 백분위와 최하위 백분위 안의 비단조성을 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; Rs=D['R_suspect']; R=D['R']
xc=np.clip(x,0.0,1.9); keep=(off>=40)&(off<=70)&(~Rs); rsel=np.flatnonzero(keep)
key=rounds*2.0+xc; o=np.argsort(key,kind='stable'); ks=key[o]; xsrt=xc[o]; rsrt=rounds[o]
sp=np.concatenate([[0],np.cumsum(off)[:-1]]); Nr=off[rsel]
print("백분위는 통제 가능한가 (고정 x0 하에서 실제로 떨어지는 백분위):")
for x0 in [0.985,0.990,0.995,1.000,1.005]:
    idx=np.searchsorted(ks,rsel*2.0+x0,side='left')-1
    same=(idx>=0)&(rsrt[np.clip(idx,0,len(ks)-1)]==rsel)
    nb=np.where(same,idx-sp[rsel]+1,0); pc=nb/Nr
    print(f"  x0={x0:.3f}: 백분위 5~95% = {np.percentile(pc,5):.3f}~{np.percentile(pc,95):.3f}  P(최하위10%) {np.mean(pc<0.1):.3f}")
# 고정 x 안에서 백분위 효과 = 경쟁자 운 (행동 불가)
sub=keep[rounds]
N=off[rounds]
rk=np.empty(len(x),np.int64)
o2=np.lexsort((x,rounds)); rs2=rounds[o2]
nw=np.empty(len(rs2),bool); nw[0]=True; nw[1:]=rs2[1:]!=rs2[:-1]
rk[o2]=np.arange(len(rs2))-np.maximum.accumulate(np.where(nw,np.arange(len(rs2)),0))
pct=rk/np.maximum(N-1,1)
brate=win[sub].mean()
print(f"\n=== 1.536배의 분해: 절대 x (선택 가능) vs 회차내 백분위 (선택 불가) ===")
print("x 구간을 고정한 뒤 백분위 10분위별 낙찰 배수:")
xb=[(0.980,0.990),(0.990,0.995),(0.995,0.9985),(0.9985,1.0015),(1.0015,1.005),(1.005,1.015)]
for lo,hi in xb:
    m0=sub&(x>=lo)&(x<hi)
    if m0.sum()<5000: continue
    r0=win[m0].mean()/brate
    lowp=m0&(pct<0.1); midp=m0&(pct>=0.5)&(pct<0.6)
    s=f"  x∈[{lo:.4f},{hi:.4f}) n={m0.sum():>7,} 전체배수 {r0:5.3f} |"
    s+=f" 백분위<10%: n={lowp.sum():>7,} 배수 {win[lowp].mean()/brate:5.3f}" if lowp.sum()>300 else " 백분위<10%: n/a"
    s+=f" | 50~60%: n={midp.sum():>7,} 배수 {win[midp].mean()/brate:5.3f}" if midp.sum()>300 else " | 50~60%: n/a"
    print(s)
print("\n반대로 백분위를 고정하고 x 로 쪼개면:")
for plo,phi in [(0.0,0.1),(0.5,0.6)]:
    m0=sub&(pct>=plo)&(pct<phi)
    qs=np.quantile(x[m0],[.25,.5,.75])
    g=np.digitize(x[m0],qs)
    xs_=x[m0]; ws=win[m0]
    print(f"  백분위 {plo:.1f}~{phi:.1f}: "+"  ".join(f"x4분위{k+1}(중앙{np.median(xs_[g==k]):.4f}) 배수 {ws[g==k].mean()/brate:.3f}" for k in range(4)))
