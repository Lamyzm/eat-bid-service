"""모듈 책임: 슬롯 편차 벡터의 카이제곱과 순열 영분포로 투표 지렛대의 상한을 잡는다."""

import numpy as np
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,bid_id=P['rate'],P['bid_id']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
srt=np.sort(rate,axis=1); safe=ok&(xmax>=srt[:,-4:].mean(1))
cent=(rate-rate.mean(1)[:,None])*1e4

def lever(d):                      # 내 2표가 4자리 중 2자리를 결정할 때의 최대 폭
    s=np.sort(d); return (s[-2:].sum()-s[:2].sum())/4.0

rng=np.random.default_rng(7)
for lbl,sel in [('전체(콜라이더 오염)',ok),('안전집합(깨끗)',safe)]:
    C=cent[sel]; n=len(C)
    d=C.mean(0); se=C.std(0,ddof=1)/np.sqrt(n)
    chi=((d/se)**2).sum()
    obs=lever(d)
    # 영분포: 회차 안에서 슬롯 라벨을 섞는다 (슬롯↔가격 독립 귀무)
    null=[]
    for _ in range(400):
        idxp=rng.permuted(np.tile(np.arange(15),(n,1)),axis=1)
        null.append(lever(np.take_along_axis(C,idxp,1).mean(0)))
    null=np.array(null)
    print('%s  n=%d'%(lbl,n))
    print('   δ 벡터 카이제곱 %.2f (df=14, 5%% 임계 23.68)  →  %s'
          %(chi,'구조 있음' if chi>23.68 else '🔴 0 과 구분 안 됨'))
    print('   지렛대 관측 %.4f bp   영분포 평균 %.4f  sd %.4f  p95 %.4f'
          %(obs,null.mean(),null.std(),np.percentile(null,95)))
    print('   → 영분포 초과 여부: %s   (관측이 영분포의 상위 %.1f%%)'
          %('예' if obs>np.percentile(null,95) else '🔴 아니오', 100*(null<obs).mean()))
    print('   95%% 상한(영분포 p95 를 상한으로): %.4f bp = 창문(5.8)의 1/%.0f'
          %(np.percentile(null,95), 5.8/np.percentile(null,95)))
    print()
