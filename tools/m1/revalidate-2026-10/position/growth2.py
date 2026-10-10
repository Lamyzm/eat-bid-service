"""모듈 책임: 하한율 90·88 회차의 '마감 1시간 전 참여 수 ÷ h시간 전 참여 수' 중앙값을 남은 시간·현재 참여 수 구간별로 2025년까지 자료로 낸다(제품 보정표의 원천)."""
import numpy as np, sys, io, json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; Rs=z['R_suspect']; floor=z['floor']; ym=z['ym']
rounds=np.repeat(np.arange(len(cnt)),cnt)
H=[(1,2),(2,4),(4,6),(6,9),(9,12),(12,15),(15,18),(18,21),(21,24),(24,36),(36,48)]
NB=[(1,5),(5,10),(10,20),(20,30),(30,40),(40,70),(70,None)]
out={}
for f in (90.0,88.0):
    sel=np.where((~Rs)&(floor==f)&(cnt>=2)&(ym<=202512))[0]
    NA=np.bincount(rounds[t>=1.0],minlength=len(cnt))[sel]
    print(f"하한율 {f}  (행: 남은 시간 구간, 칸: 현재 참여 수 구간별 배율 중앙값)")
    print("          " + "".join(f"{lo}~{hi or '':<4}".rjust(9) for lo,hi in NB))
    rows=[]
    for a,b in H:
        mid=(a+b)/2; nh=np.bincount(rounds[t>=mid],minlength=len(cnt))[sel]; cells=[]
        for lo,hi in NB:
            q=(nh>=lo)&(nh<(hi if hi else 10**9))
            cells.append(round(float(np.median(NA[q]/nh[q])),2) if q.sum()>=200 else None)
        rows.append({"from":a,"to":b,"ratios":cells})
        print(f"{a:>3}~{b:<3}h  " + "".join((f"{c:.2f}" if c else "  -  ").rjust(9) for c in cells))
    out[str(int(f))]=rows
json.dump({"hours":H,"counts":NB,"floors":out},open("growth2.json","w",encoding="utf-8"),indent=1)
