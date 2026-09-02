"""모듈 책임: 슬롯별 회차 내 중심화 가격 편차를 재 번호 선택이 가진 최대 지렛대를 계산한다."""

import numpy as np
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,chosen,bid_id=P['rate'],P['chosen'],P['bid_id']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
votes=np.zeros((len(bid_id),15),dtype=np.int32); votes[ok]=B['votes_all'][idx[ok]]
nbid=np.zeros(len(bid_id),dtype=np.int64); nbid[ok]=B['nbid'][idx[ok]]
srt=np.sort(rate,axis=1); Rmax=srt[:,-4:].mean(1)
safe=ok&(xmax>=Rmax)
m=rate.mean(1)
cent=rate-m[:,None]          # 회차 내 중심화 가격

def deltas(sel):
    return cent[sel].mean(0)*1e4      # 슬롯별 δ_s (bp)

print('=== 슬롯별 평균 가격 편차 δ_s (bp, 회차 내 중심화) ===')
for lbl,sel in [('전체    ',ok),('안전집합',safe),('나머지  ',ok&~safe)]:
    d=deltas(sel); n=sel.sum()
    se=(cent[sel].std(0,ddof=1)/np.sqrt(n))*1e4
    print('%s n=%7d  폭 %.3f bp  |δ|최대 %.3f  평균SE %.3f'%(lbl,n,d.max()-d.min(),np.abs(d).max(),se.mean()))
    print('   ', ' '.join('%+.2f'%v for v in d))

print()
print('=== 🔴 화면 문구용 재계산: 번호 선택의 최대 지렛대 ===')
for lbl,sel in [('전체(오염)',ok),('안전집합(깨끗)',safe)]:
    d=deltas(sel); ds=np.sort(d)
    ceil2=(ds[:2].sum())/4.0          # 4자리 중 2자리를 내가 최저 δ 슬롯으로 채웠을 때
    ceil2h=(ds[-2:].sum())/4.0
    print('%s  δ 폭 %.3f bp' % (lbl, d.max()-d.min()))
    print('   상한(내 2표가 4자리 중 2자리를 완전히 결정): %+.4f ~ %+.4f bp  → 폭 %.4f bp'
          %(ceil2,ceil2h,ceil2h-ceil2))
    n=sel.sum(); se=(cent[sel].std(0,ddof=1)/np.sqrt(n)*1e4)
    print('   ⚠ δ 자체의 SE 평균 %.4f bp — δ 가 잡음과 구분되나: |δ|max/SE = %.2f'%(se.mean(),np.abs(d).max()/se.mean()))

print()
print('=== 참고: 창문과의 대비 ===')
print('   승부 창문 5.8 bp')
d=deltas(safe); ds=np.sort(d)
print('   깨끗한 상한 폭 %.4f bp = 창문의 %.4f배 = 1/%.0f'
      %((ds[-2:].sum()-ds[:2].sum())/4.0,(ds[-2:].sum()-ds[:2].sum())/4.0/5.8,
        5.8/max((ds[-2:].sum()-ds[:2].sum())/4.0,1e-9)))
print()
print('=== N<=2 를 뺀 안전집합에서도 확인 ===')
s2=safe&(nbid>=3); d=deltas(s2); ds=np.sort(d)
print('   n=%d  δ폭 %.3f bp  상한폭 %.4f bp'%(s2.sum(),d.max()-d.min(),(ds[-2:].sum()-ds[:2].sum())/4.0))
