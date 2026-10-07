"""모듈 책임: 하한율 90 회차의 투찰률 격자별 승패 행렬을 만들고 as-of N 대역별 최적 투찰률을 2025년 학습·2026년 검증으로 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; ym=z['ym']
floor=z['floor']; t=z['t']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
NAS=np.bincount(rounds[t>=1.0],minlength=len(cnt))      # as-of N (전체 투찰 기준)
G=np.arange(0.978,1.0081,0.0005)
sel=np.where((~Rs)&(floor==90.0)&(cnt>=2))[0]
M=np.zeros((len(sel),len(G)),bool); NT=np.zeros(len(sel)); YM=ym[sel]; NA=NAS[sel]
for i,r in enumerate(sel):
    s,e=starts[r],starts[r]+cnt[r]
    o=np.sort(x[s:e]); Rr=float(R[r])
    oo=o[o>=Rr]; c=np.searchsorted(oo,G,side='left')
    M[i]=(G>=Rr)&(c==0); NT[i]=len(o)
np.savez_compressed("winmat.npz",M=M,NT=NT,YM=YM,NA=NA,G=G)
BANDS=[(1,9),(10,19),(20,29),(30,39),(40,49),(50,59),(60,69),(70,89),(90,119),(120,999)]
tr=YM<=202512; te=YM>=202601
print(f"{'as-of N':>10} {'검증회차':>7} {'최적비율':>8} {'검증낙찰률':>9} {'대역평균':>8} {'배수':>6} {'안전하한':>8}")
for lo,hi in BANDS:
    bt=tr&(NA>=lo)&(NA<=hi); bv=te&(NA>=lo)&(NA<=hi)
    if bt.sum()<300 or bv.sum()<100: continue
    rate_tr=M[bt].mean(axis=0)
    k=int(np.argmax(rate_tr)); xs=G[k]
    rv=M[bv][:,k].mean()
    basev=np.minimum(1.0/np.maximum(NT[bv],1),1).mean()
    # 안전 하한: 학습기에서 배수가 1.0 밑으로 떨어지는 가장 높은 x (최적보다 아래)
    base_tr=np.minimum(1.0/np.maximum(NT[bt],1),1).mean()
    below=[G[m] for m in range(k) if rate_tr[m]<base_tr]
    safe=max(below) if below else G[0]
    print(f"{lo:4d}-{hi:<5d} {int(bv.sum()):7d} {xs:8.4f} {rv*100:8.2f}% {basev*100:7.2f}% {rv/basev:6.3f} {safe:8.4f}")
