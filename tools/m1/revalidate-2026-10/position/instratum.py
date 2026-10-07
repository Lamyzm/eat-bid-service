"""모듈 책임: N 대역 안에서 회차 내 백분위 10분위별 낙찰률과 실격률을 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); f=np.load("gapfeat.npz")
cnt=z['off']; wd=z['wd']; Rs=z['R_suspect']; x=z['x']; R=z['R']; nbid=z['nbid']; win=z['is_recorded_winner']
rounds=np.repeat(np.arange(len(cnt)),cnt)
pct=f['pct']; dR=(x-R[rounds])
for lo,hi in [(3,9),(10,29),(40,70),(71,200)]:
    m=(~wd)&(~Rs[rounds])&(nbid[rounds]>=lo)&(nbid[rounds]<=hi)&np.isfinite(pct)
    pc=pct[m]; w=win[m]; d=dR[m]
    base=w.mean()
    print(f"\nN {lo}-{hi}   투찰 {int(m.sum()):,}   평균 낙찰률 {base*100:.3f}%")
    print(f"   {'회차내 백분위':>12} {'낙찰률':>8} {'평균대비':>8}  {'실격률':>7}")
    for i in range(10):
        s=(pc>=i/10)&(pc<(i+1)/10)
        if s.sum()<200: continue
        r=w[s].mean()
        print(f"   {i/10:.1f}~{(i+1)/10:.1f}      {r*100:7.3f}%  {r/base:7.2f}배  {(d[s]<0).mean()*100:6.1f}%")
