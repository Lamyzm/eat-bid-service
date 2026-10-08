"""모듈 책임: 새 다섯 대역 규칙에서 참여 수를 마감 h시간 전에 볼 때 대역 선택(그대로·증가 보정)이 1~3장 검증 낙찰과 적용 범위를 어떻게 바꾸는지 2026-01~08로 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; Rs=z['R_suspect']; floor=z['floor']
rounds=np.repeat(np.arange(len(cnt)),cnt)
sel=np.where((~Rs)&(floor==90.0)&(cnt>=2))[0]
d=np.load("winmat.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
col=lambda v:int(np.argmin(np.abs(G-v)))
EDGES=[10,20,30,40,70]
VAL=[[0.9925,1.0000,0.9960],[0.9925,0.9885,0.9970],[0.9885,0.9935,0.9985],[0.9860,0.9920,0.9955],[0.9835,0.9890,0.9910]]
band=lambda n: np.searchsorted(EDGES,n,side='right')-1     # -1 = 10곳 미만(규칙 없음)
n_at=lambda h: np.bincount(rounds[t>=h],minlength=len(cnt))[sel]
tr=YM<=202512; te=(YM>=202601)&(YM<=202608)
b1=band(NA)
def score(b,mask,k):
    m=mask&(b>=0); w=np.zeros(m.sum(),bool); bb=b[m]; X=M[m]
    for i,v in enumerate(VAL):
        mm=bb==i
        for j in range(k): w[mm]|=X[mm][:,col(v[j])]
    lot=np.minimum(k/np.maximum(NT[m],1),1)
    return m.sum(), w.sum(), lot.sum()
target=te&(b1>=0)
for k in (1,2):
    n0,w0,l0=score(b1,te,k)
    print(f"[{k}장] 마감 1h 전 기준: 적용 {n0:,} · 낙찰 {w0} · 운 {l0:.1f} · {w0/l0:.3f}배")
    for h in [6,12,24]:
        nh=n_at(h); g=np.ones(len(nh))
        e=[0,5,10,20,30,40,60,80,10**6]
        for lo,hi in zip(e[:-1],e[1:]):
            q=tr&(nh>=lo)&(nh<hi)&(nh>0)
            if q.sum()>50: g[(nh>=lo)&(nh<hi)]=np.median(NA[q]/nh[q])
        for lab,b in [("그대로",band(nh)),("증가보정",band(np.round(nh*g)))]:
            n,w,l=score(b,te,k)
            agree=((b==b1)&target).sum()/target.sum()
            print(f"   {h:>2}h {lab:<6} 적용 {n:>6,}({n/n0*100:5.1f}%) 대역일치 {agree*100:5.1f}% 낙찰 {w:>4} 운 {l:7.1f} {w/l:.3f}배")
