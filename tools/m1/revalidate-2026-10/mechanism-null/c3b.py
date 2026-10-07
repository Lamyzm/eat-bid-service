"""모듈 책임: 고정 투찰률 x0를 회차에 반사실로 넣어 실제로 가져갈 수 있는 배수를 잰다."""
import os, sys; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np, base
D=base.load()
off=D['off']; nR=len(off); rounds=np.repeat(np.arange(nR),off)
x=D['x'].astype(np.float64); win=D['is_recorded_winner']; Rs=D['R_suspect']; R=D['R']
xc=np.clip(x,0.0,1.9)
keep=(off>=40)&(off<=70)&(~Rs)
rsel=np.flatnonzero(keep)
key=rounds*2.0+xc
o=np.argsort(key,kind='stable'); ks=key[o]; xsrt=xc[o]; rsrt=rounds[o]
startpos=np.concatenate([[0],np.cumsum(off)[:-1]])
Rr=R[rsel]; Nr=off[rsel]
base=np.mean(1.0/Nr)
print(f"회차 {len(rsel):,}  평균 N {Nr.mean():.1f}  기준 승률 1/N 평균 {base:.5f}")
print("\n고정 x0 전략의 실제 성과 (반사실 삽입):")
print(" x0      실현승률   배수   낙찰시회차내백분위(평균)  x0이떨어지는백분위 평균/sd")
grid=np.concatenate([np.arange(0.960,0.9951,0.005),np.arange(0.996,1.0121,0.002),[1.015,1.020,1.025,1.030,1.040]])
rows=[]
for x0 in grid:
    idx=np.searchsorted(ks,rsel*2.0+x0,side='left')-1
    same=(idx>=0)&(rsrt[np.clip(idx,0,len(ks)-1)]==rsel)
    g=np.where(same,xsrt[np.clip(idx,0,len(ks)-1)],0.0)
    w=(Rr>g)&(Rr<=x0)
    nbelow=np.where(same,idx-startpos[rsel]+1,0)
    pc=nbelow/Nr
    rows.append((x0,w.mean(),w.mean()/base,pc.mean(),pc.std()))
    print(f" {x0:.3f}  {w.mean():.5f}  {w.mean()/base:6.3f}      -                     {pc.mean():.3f} / {pc.std():.3f}")
rows=np.array(rows)
best=rows[np.argmax(rows[:,1])]
print(f"\n최적 고정 x0 = {best[0]:.3f}  승률 {best[1]:.5f}  배수 {best[2]:.3f}")
print(f"'최하위 10% 백분위' 를 노리는 전략(x0 s.t. 평균백분위≈0.05~0.10):")
m=(rows[:,3]>=0.03)&(rows[:,3]<=0.15)
for r in rows[m]: print(f"   x0={r[0]:.3f} 평균백분위 {r[3]:.3f}  승률 {r[1]:.5f}  배수 {r[2]:.3f}")
print(f"\n관측된 '최하위 10분위 투찰' 의 사후 배수 1.536 vs 그 백분위를 겨냥한 사전 전략의 배수: 위 표 참조")
# 고정 x0 를 쓸 때 실제로 떨어지는 백분위의 분산 -> 백분위는 통제 불가
print("\n백분위 통제 가능성: 고정 x0 하에서 회차별 백분위 분포")
for x0 in [0.985,0.995,1.000,1.005]:
    idx=np.searchsorted(ks,rsel*2.0+x0,side='left')-1
    same=(idx>=0)&(rsrt[np.clip(idx,0,len(ks)-1)]==rsel)
    nbelow=np.where(same,idx-startpos[rsel]+1,0); pc=nbelow/Nr
    print(f"  x0={x0:.3f}: 백분위 분위 {np.round(np.percentile(pc,[5,25,50,75,95]),3).tolist()}  최하위10%에 들 확률 {np.mean(pc<0.1):.3f}")
