"""모듈 책임: 하한율 90 회차에서 마감 h시간 전 참여 수 대비 마감 1시간 전 참여 수의 배율을 남은 시간·현재 참여 수 구간별로 2025년까지 자료로 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; Rs=z['R_suspect']; floor=z['floor']; ym=z['ym']
rounds=np.repeat(np.arange(len(cnt)),cnt)
sel=np.where((~Rs)&(floor==90.0)&(cnt>=2)&(ym<=202512))[0]
NA=np.bincount(rounds[t>=1.0],minlength=len(cnt))[sel]
H=[(1,3,2),(3,6,4.5),(6,12,9),(12,24,18),(24,48,36)]
NB=[(1,10),(10,20),(20,30),(30,40),(40,70),(70,10**6)]
print("남은시간\현재참여  " + "  ".join(f"{lo}~{hi if hi<10**6 else ''}" .rjust(7) for lo,hi in NB))
for lo,hi,mid in H:
    nh=np.bincount(rounds[t>=mid],minlength=len(cnt))[sel]
    cells=[]
    for a,b in NB:
        q=(nh>=a)&(nh<b)
        cells.append(f"{np.median(NA[q]/nh[q]):.2f}({q.sum()//1000}k)" if q.sum()>200 else "   -   ")
    print(f"{lo:>2}~{hi:<2}h(@{mid:>4})  " + "  ".join(c.rjust(7) for c in cells))
