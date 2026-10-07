"""모듈 책임: as-of N 40~69와 70 이상 대역에서 투찰률별 학습·검증 배수 곡선을 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=np.load("winmat.npz"); M=d['M']; NT=d['NT']; YM=d['YM']; NA=d['NA']; G=d['G']
for lo,hi,lab in [(40,69,"아버지 구간 as-of N 40-69"),(70,999,"N 70+")]:
    tr=(YM<=202512)&(NA>=lo)&(NA<=hi); te=(YM>=202601)&(NA>=lo)&(NA<=hi)
    base=np.minimum(1.0/np.maximum(NT[te],1),1).mean()
    print(f"\n=== {lab}   학습 {int(tr.sum()):,}  검증 {int(te.sum()):,}  대역평균 {base*100:.2f}%")
    print(f"{'비율':>8} {'학습배수':>8} {'검증배수':>8} {'검증낙찰률':>9}")
    for k in range(0,len(G)):
        g=float(G[k])
        if abs(round(g*1000)-g*1000)>1e-6 or round(g*1000)%2: continue   # 0.002 간격
        if g<0.980 or g>1.002: continue
        btr=np.minimum(1.0/np.maximum(NT[tr],1),1).mean()
        a=M[tr][:,k].mean()/btr; b=M[te][:,k].mean()/base
        mark=" ←" if b>=1.3 else ""
        print(f"{g:8.4f} {a:8.3f} {b:8.3f} {M[te][:,k].mean()*100:8.2f}%{mark}")
