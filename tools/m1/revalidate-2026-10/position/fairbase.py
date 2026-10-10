"""모듈 책임: 규칙 표를 운 기준선 두 가지(장수÷참여 수, 장수÷(참여 수+장수))로 다시 채점해 작은 대역에서 기준선 편향이 얼마나 큰지 낸다."""
import numpy as np, sys, io, json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
for floor in ("90","88"):
    d=np.load(f"winmat{floor}.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
    rule=json.load(open(f"rule{floor}.json",encoding="utf-8"))
    te=(YM>=202601)&(YM<=202608)
    col=lambda v:int(np.argmin(np.abs(G-float(v))))
    print(f"하한율 {floor}")
    for b in rule["bands"]:
        hi=b["hi"] or 10**6; m=te&(NA>=b["lo"])&(NA<=hi); won=np.zeros(m.sum(),bool); out=[]
        for k,p in enumerate(b["positions"],1):
            won|=M[m][:,col(p["multiple"])]
            old=np.minimum(k/np.maximum(NT[m],1),1).mean(); fair=(k/(NT[m]+k)).mean()
            out.append(f"{won.mean()/old:.2f}→{won.mean()/fair:.2f}")
        print(f"  {b['lo']}~{b['hi'] or '':<3} (중앙 참여 {int(np.median(NT[m]))}) " + " | ".join(out))
