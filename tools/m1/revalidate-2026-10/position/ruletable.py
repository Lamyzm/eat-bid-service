"""모듈 책임: 추천 투찰가(서버 `bid-position-rule.ts`)에 넣는 대역별 누적 투찰률 조합의 2026년 1~8월 검증 낙찰률과 운 기준선을 정확한 조합 그대로 낸다."""
import numpy as np, sys, io, os
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=np.load("winmat.npz")   # position/table.py가 실행 디렉터리에 만든다
M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
col=lambda v:int(np.argmin(np.abs(G-v)))
RULES={"40~69곳":(40,69,[0.9855,0.9920,0.9945]),"70곳 이상":(70,10**6,[0.9830,0.9900,0.9880])}
for lab,(lo,hi,seq) in RULES.items():
    for nm,ym_lo,ym_hi in [("학습 ~2025",0,202512),("검증 2026-01~08",202601,202608)]:
        m=(YM>=ym_lo)&(YM<=ym_hi)&(NA>=lo)&(NA<=hi)
        print(f"[{lab}] {nm}  회차 {int(m.sum()):,}")
        w=np.zeros(int(m.sum()),bool)
        for k,v in enumerate(seq,1):
            w|=M[m][:,col(v)]; base=np.minimum(k/np.maximum(NT[m],1),1).mean()
            print(f"   {k}장 {seq[:k]}  낙찰률 {w.mean()*100:.6f}%  운 {base*100:.6f}%  {w.mean()/base:.2f}배  (낙찰 {int(w.sum())})")
