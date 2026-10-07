"""모듈 책임: as-of N 대역별로 두 장·세 장 투찰률 조합을 2025년까지로 고르고 2026년 1~8월로 검증한다."""
import numpy as np, sys, io, itertools, os
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=np.load("winmat.npz")   # position/table.py가 실행 디렉터리에 만든다
M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
keep=(G>=0.980)&(G<=1.004); Gk=G[keep]; Mk=M[:,keep]
POP=np.array([bin(i).count("1") for i in range(256)],dtype=np.int64)
def best(mask,k):
    P=np.packbits(Mk[mask],axis=0)                     # (bytes, grid)
    bestv,bc=-1,None
    for c in itertools.combinations(range(len(Gk)),k):
        o=P[:,c[0]].copy()
        for j in c[1:]: o|=P[:,j]
        v=int(POP[o].sum())
        if v>bestv: bestv,bc=v,c
    return bc,bestv
for lab,lo,hi in [("40~69곳",40,69),("70곳 이상",70,10**6)]:
    tr=(YM<=202512)&(NA>=lo)&(NA<=hi); te=(YM>=202601)&(YM<=202608)&(NA>=lo)&(NA<=hi)
    print(f"\n[{lab}] 학습 {int(tr.sum()):,} · 검증 {int(te.sum()):,}회차")
    for k in (1,2,3):
        c,_=best(tr,k)
        w=np.zeros(int(te.sum()),bool)
        for j in c: w|=Mk[te][:,j]
        base=np.minimum(k/np.maximum(NT[te],1),1).mean()
        print(f"  {k}장 {' + '.join(f'{Gk[j]:.4f}' for j in c):26s}  검증 낙찰률 {w.mean()*100:5.2f}%  ({k}장 운 {base*100:4.2f}%, {w.mean()/base:.2f}배)")
