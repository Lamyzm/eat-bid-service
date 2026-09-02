import numpy as np
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,chosen,bid_id=P['rate'],P['chosen'],P['bid_id']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id])
ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
votes=np.zeros((len(bid_id),15),dtype=np.int32); votes[ok]=B['votes_all'][idx[ok]]
nb=np.zeros(len(bid_id),dtype=np.int32); nb[ok]=B['nbid'][idx[ok]]
print('조인 %d / %d' % (ok.sum(), len(bid_id)))

srt=np.sort(rate,axis=1)
top4=srt[:,-4:].mean(1)              # 가능한 최대 R
safe=ok & (xmax>=top4)
print('안전 부분집합 %d (%.1f%%)' % (safe.sum(), 100*safe.mean()))

# D
m=rate.mean(1); R=(rate*chosen).sum(1)/4.0; D=R-m

# 회차별 Spearman(슬롯번호, 가격).  슬롯번호는 이미 1..15 순서
n,k=rate.shape
rk=np.argsort(np.argsort(rate,axis=1),axis=1).astype(np.float64)   # 가격 순위 0..14
slot=np.arange(k,dtype=np.float64)
d2=((rk-slot)**2).sum(1)
rho=1-6*d2/(k*(k*k-1))

def rep(lbl,sel):
    s=sel & np.isfinite(D)
    N=s.sum()
    dm=D[s].mean(); dse=D[s].std(ddof=1)/np.sqrt(N)
    rm=rho[s].mean(); rse=rho[s].std(ddof=1)/np.sqrt(N)
    print('%-16s n=%7d   D=%+8.4f bp (SE %.4f, z=%+7.2f)   rho=%+.6f (SE %.6f, z=%+6.2f)'
          %(lbl,N,dm*1e4,dse*1e4,dm/dse,rm,rse,rm/rse))

print()
print('=== 🔴 핵심: 슬롯↔가격 상관이 007 인공물인가 ===')
rep('전체',ok)
rep('안전 부분집합',safe)
rep('나머지',ok&~safe)
print()
print('=== N 구간별 (안전 부분집합 안에서) ===')
for lo,hi,l in [(1,1,'N=1'),(2,2,'N=2'),(3,4,'N=3-4'),(5,9,'N=5-9'),(10,29,'N=10-29'),(30,99,'N=30-99'),(100,10**9,'N=100+')]:
    rep('  '+l, safe&(nb>=lo)&(nb<=hi))
print()
print('=== 참고: 동점 발생률 (votes_all 기준) ===')
v=votes; sv=np.sort(v,axis=1)[:,::-1]
has4=(v>0).sum(1)>=4
tie=has4&(sv[:,3]==sv[:,4])
print('  득표슬롯>=4 인 회차 %.4f' % has4[ok].mean())
print('  그중 4위 동점  %.4f  (전체 대비 %.4f)' % (tie[ok].sum()/max(has4[ok].sum(),1), tie[ok].mean()))
print('  득표슬롯<4 (채움 필요) %.4f' % (~has4[ok]).mean())
