"""모듈 책임: 예측 N 코호트가 실제 N이 예측보다 높게 나온 회차에 편중됐음을 보인다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; nbid=z['nbid']; ym=z['ym']; floor=z['floor']; item=z['item']; Rs=z['R_suspect']; bid=z['bid_id']
common,iz,ia=np.intersect1d(bid,a['bid_id'],return_indices=True)
purr=np.full(len(cnt),"?",dtype='<U12'); purr[iz]=np.array(a['purr'])[ia]
kpi=np.array([p+"|"+str(i) for p,i in zip(purr,item)])
hist=(ym<=202512)&(floor==90.0)&(~Rs)
d={}
for k,v in zip(kpi[hist],nbid[hist]): d.setdefault(k,[]).append(int(v))
A={k:float(np.median(v)) for k,v in d.items() if len(v)>=3}
d2={}
for k,v in zip(purr[hist],nbid[hist]): d2.setdefault(k,[]).append(int(v))
B={k:float(np.median(v)) for k,v in d2.items() if len(v)>=3}
gl=float(np.median(nbid[hist]))
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
pn=np.array([A.get(kpi[r], B.get(purr[r], gl)) for r in te])
print("주장 코호트 3438: 실제 N 중위 %.0f, 과거 같은 기관×품목 예측 N 중위 %.0f"%(np.median(nbid[te]),np.median(pn)))
print("  예측 N < 40 인 회차: %d (%.1f%%)   예측<20: %d (%.1f%%)"%(
    (pn<40).sum(),100*(pn<40).mean(),(pn<20).sum(),100*(pn<20).mean()))
print("  전체 2026 floor90 실제 N 중위 %.0f"%np.median(nbid[(ym>=202601)&(~Rs)&(floor==90.0)]))
