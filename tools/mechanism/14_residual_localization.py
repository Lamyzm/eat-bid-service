import numpy as np
E=np.load(r'F:/Project/eat-bid/data/mechanism/_enum_pred.npz',allow_pickle=True)
J=np.load(r'F:/Project/eat-bid/data/mechanism/_join.npz',allow_pickle=True)
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
pred,D,valid=E['pred'],E['D'],E['valid']
nbid,nwd,votes,R,m=J['nbid'],J['nwd'],J['votes'],J['R'],J['m']
bid_id=P['bid_id']; bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmin=np.full(len(bid_id),np.nan); xmin[ok]=B['xmin'][idx[ok]]
xmax=J['xmax']

sv=-np.sort(-votes,axis=1); nvoted=(votes>0).sum(1)
has4=nvoted>=4; tie=has4&(sv[:,3]==sv[:,4])
grp={'A (동점·채움 없음)':has4&~tie,'B-동점':has4&tie,'B-채움':~has4}

def line(lbl,s):
    q=s&valid; n=q.sum()
    if n<50: print('%-24s n=%6d (부족)'%(lbl,n)); return
    d=D[q]-pred[q]; se=d.std(ddof=1)/np.sqrt(n)
    print('%-24s n=%7d  관측%+7.3f  귀무%+7.3f  차%+7.3f (z=%+6.2f)  기여%+6.3f'
          %(lbl,n,D[q].mean()*1e4,pred[q].mean()*1e4,d.mean()*1e4,d.mean()/se,
            d.mean()*1e4*n/valid.sum()))

print('=== 🔴 N<=2 잔차(+3.41)를 A/B 로 쪼갠다 ===')
small=nbid<=2
for k,v in grp.items(): line('  N<=2 · '+k, small&v)
print('\n=== 대조: N>=3 ===')
for k,v in grp.items(): line('  N>=3 · '+k, (~small)&v)

print('\n=== 🔴 생존 조건이 한쪽인가 양쪽인가 — 투찰 범위를 본다 ===')
for lo,hi,l in [(1,2,'N<=2'),(3,9,'N=3-9'),(10,10**9,'N>=10')]:
    q=valid&(nbid>=lo)&(nbid<=hi)&np.isfinite(xmin)
    r=R[q]
    print('  %-7s n=%7d   xmax/R  p50 %.4f p95 %.4f p99 %.4f   xmin/R p05 %.4f p50 %.4f'
          %(l,q.sum(),*np.percentile(xmax[q]/r,[50,95,99]),*np.percentile(xmin[q]/r,[5,50])))
print('  전체 xmax/R 이 1.10 을 넘는 비율 %.4f · 1.30 초과 %.4f'
      %(np.nanmean(xmax[valid]/R[valid]>1.10),np.nanmean(xmax[valid]/R[valid]>1.30)))
print('  xmin < R 인 비율(커트라인 미달 투찰 존재) %.4f'%np.nanmean(xmin[valid&np.isfinite(xmin)]<R[valid&np.isfinite(xmin)]))
