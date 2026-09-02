"""모듈 책임: 선택 편향 D 를 동점·채움 경로로 나눠 회차 비율과 함께 A/B 로 분해한다."""

import numpy as np, itertools
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,chosen,bid_id=P['rate'],P['chosen'],P['bid_id']
year,floor=P['year'],P['floor']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
def pull(k):
    a=np.full(len(bid_id),np.nan); a[ok]=B[k][idx[ok]]; return a
xmax=pull('xmax'); xmax_nw=pull('xmax_nonwd'); nwd=pull('nwithdraw'); nbid=pull('nbid')
votes=np.zeros((len(bid_id),15),dtype=np.int32); votes[ok]=B['votes_all'][idx[ok]]

m=rate.mean(1); R=(rate*chosen).sum(1)/4.0; D=R-m
srt=np.sort(rate,axis=1); Rmax=srt[:,-4:].mean(1); Rmin=srt[:,:4].mean(1)
safe=ok&(xmax>=Rmax)
print('조인 %d · 안전 %d (%.1f%%)  [xmax_nonwd 기준 %.1f%%]'
      %(ok.sum(),safe.sum(),100*safe.sum()/ok.sum(),100*(ok&(xmax_nw>=Rmax)).sum()/ok.sum()))
print('항등식 xmax>=R : %.4f%%   xmax_nonwd>=R : %.4f%%'
      %(100*(xmax[ok]>=R[ok]).mean(),100*(xmax_nw[ok]>=R[ok]).mean()))

def rep(lbl,s):
    s=s&np.isfinite(D); n=s.sum()
    if n<30: print('%-26s n=%6d   (표본 부족)'%(lbl,n)); return
    d=D[s]; mu=d.mean(); se=d.std(ddof=1)/np.sqrt(n)
    print('%-26s n=%7d   D=%+8.3f bp (SE %.3f, z=%+6.2f)'%(lbl,n,mu*1e4,se*1e4,mu/se))

sv=-np.sort(-votes,axis=1); nvoted=(votes>0).sum(1)
has4=nvoted>=4; tie=has4&(sv[:,3]==sv[:,4])
A=has4&~tie; Btie=has4&tie; Bfill=~has4
print('\n=== 🔴 A/B 분해 (안전 부분집합 안에서) ===')
print('  회차 비율:  A %.4f · B-동점 %.4f · B-채움 %.4f'%(A[ok].mean(),Btie[ok].mean(),Bfill[ok].mean()))
rep('  A (규칙 미개입)',safe&A)
rep('  B-동점',safe&Btie)
rep('  B-채움',safe&Bfill)
print('  [대조] 전체 표본에서')
rep('  A',ok&A); rep('  B-동점',ok&Btie); rep('  B-채움',ok&Bfill)

print('\n=== 🔴 N<=2 양수의 정체: 철회로 갈라 본다 (안전 부분집합) ===')
for lo,hi,l in [(0,0,'철회 0명'),(1,2,'철회 1-2'),(3,9,'철회 3-9'),(10,10**9,'철회 10+')]:
    rep('  nbid<=2 · %s'%l, safe&(nbid<=2)&(nwd>=lo)&(nwd<=hi))
print('  [대조] nbid>=3')
for lo,hi,l in [(0,0,'철회 0명'),(1,2,'철회 1-2'),(3,10**9,'철회 3+')]:
    rep('  nbid>=3 · %s'%l, safe&(nbid>=3)&(nwd>=lo)&(nwd<=hi))
print('\n  nbid<=2 회차의 철회자 수: 중앙 %.0f · 평균 %.2f · 0명 비율 %.3f'
      %(np.nanmedian(nwd[safe&(nbid<=2)]),np.nanmean(nwd[safe&(nbid<=2)]),
        np.nanmean(nwd[safe&(nbid<=2)]==0)))
print('  전체 안전 회차의 철회자 0명 비율 %.3f'%np.nanmean(nwd[safe]==0))
np.savez(r'F:/Project/eat-bid/data/mechanism/_join.npz',
         xmax=xmax,xmax_nw=xmax_nw,nwd=nwd,nbid=nbid,votes=votes,ok=ok,D=D,m=m,R=R,Rmax=Rmax)
