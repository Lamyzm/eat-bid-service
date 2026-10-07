"""모듈 책임: as-of N 40~69 회차에서 두 장 투찰률 쌍을 학습기로 고르고 검증기 배수와 같은 값 두 장의 손실을 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=np.load("winmat.npz"); M=d['M']; NT=d['NT']; YM=d['YM']; NA=d['NA']; G=d['G']
lo,hi=40,69
tr=(YM<=202512)&(NA>=lo)&(NA<=hi); te=(YM>=202601)&(NA>=lo)&(NA<=hi)
Mtr=M[tr]; Mte=M[te]
b2_tr=np.minimum(2.0/np.maximum(NT[tr],1),1).mean()
b2_te=np.minimum(2.0/np.maximum(NT[te],1),1).mean()
b1_te=np.minimum(1.0/np.maximum(NT[te],1),1).mean()
print(f"학습 {int(tr.sum()):,}  검증 {int(te.sum()):,}   2장 기준선 {b2_te*100:.2f}%  1장 기준선 {b1_te*100:.2f}%")
res=[]
for i in range(len(G)):
    oi=Mtr[:,i]
    for j in range(i+1,len(G)):
        res.append((float((oi|Mtr[:,j]).mean()),i,j))
res.sort(reverse=True)
print(f"\n학습 상위 8쌍과 그 검증 성적")
print(f"{'비율1':>7} {'비율2':>7} {'학습배수':>8} {'검증배수':>8} {'검증낙찰률':>9}")
for v,i,j in res[:8]:
    te_r=float((Mte[:,i]|Mte[:,j]).mean())
    print(f"{G[i]:7.4f} {G[j]:7.4f} {v/b2_tr:8.3f} {te_r/b2_te:8.3f} {te_r*100:8.2f}%")
print(f"\n참고 — 한 장 최적(0.9880) 검증: {Mte[:,int(np.argmin(np.abs(G-0.988)))].mean()/b1_te:.3f}배 (1장 기준선 대비)")
k=int(np.argmin(np.abs(G-0.988)))
print(f"같은 비율 두 장(0.988 x2) 검증: {float((Mte[:,k]|Mte[:,k]).mean())/b2_te:.3f}배  ← 두 장 값어치 없음 확인")
