"""모듈 책임: 지정한 하한율 회차의 투찰률 격자별 승패 행렬을 table.py와 같은 정의로 만들어 winmat<하한율>.npz로 남긴다."""
import numpy as np, sys
floor_target=float(sys.argv[1])
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; Rs=z['R_suspect']; ym=z['ym']; floor=z['floor']; t=z['t']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
NAS=np.bincount(rounds[t>=1.0],minlength=len(cnt))
G=np.arange(0.978,1.0081,0.0005)
sel=np.where((~Rs)&(floor==floor_target)&(cnt>=2))[0]
M=np.zeros((len(sel),len(G)),bool); NT=np.zeros(len(sel)); YM=ym[sel]; NA=NAS[sel]
for i,r in enumerate(sel):
    s,e=starts[r],starts[r]+cnt[r]; o=np.sort(x[s:e]); Rr=float(R[r])
    oo=o[o>=Rr]; c=np.searchsorted(oo,G,side='left')
    M[i]=(G>=Rr)&(c==0); NT[i]=len(o)
np.savez_compressed(f"winmat{int(floor_target)}.npz",M=M,NT=NT,YM=YM,NA=NA,G=G)
print(f"하한율 {floor_target}: {len(sel):,}회차 → winmat{int(floor_target)}.npz")
