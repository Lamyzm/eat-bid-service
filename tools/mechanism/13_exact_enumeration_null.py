# E_H0[D | 낙찰] 을 C(15,4)=1365 전부 열거해 정확히 계산한다 (몬테카를로 없음)
import numpy as np, itertools
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,chosen,bid_id,year,floor=P['rate'],P['chosen'],P['bid_id'],P['year'],P['floor']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
nbid=np.zeros(len(bid_id),dtype=np.int64); nbid[ok]=B['nbid'][idx[ok]]

subs=list(itertools.combinations(range(15),4))          # 1365
M=np.zeros((len(subs),15)); 
for i,s in enumerate(subs): M[i,list(s)]=1.0
key={s:i for i,s in enumerate(subs)}
mask_idx=np.array([key[tuple(np.flatnonzero(c))] if c.sum()==4 else -1 for c in chosen])

m=rate.mean(1); R=(rate*chosen).sum(1)/4.0; D=R-m
nb=np.digitize(nbid,[2,3,5,7,10,13,26,51,100])          # N 구간
cell=(year.astype(np.int64)*1000+nb*10+(floor==90).astype(np.int64))
valid=ok&(mask_idx>=0)&np.isfinite(xmax)
print('유효 %d 회차 · 셀 %d 개'%(valid.sum(),len(np.unique(cell[valid]))))

# 셀별 마스크 경험분포
W={}
for c in np.unique(cell[valid]):
    s=valid&(cell==c)
    w=np.bincount(mask_idx[s],minlength=1365).astype(np.float64)
    W[c]=w/w.sum()

pred=np.full(len(bid_id),np.nan); nsurv=np.full(len(bid_id),np.nan)
vi=np.flatnonzero(valid)
CH=4000
for a in range(0,len(vi),CH):
    j=vi[a:a+CH]
    Rall=(rate[j]@M.T)/4.0                        # (chunk,1365)
    Dall=Rall-m[j][:,None]
    surv=(Rall<=xmax[j][:,None])
    w=np.stack([W[c] for c in cell[j]])           # (chunk,1365)
    den=(w*surv).sum(1); num=(w*surv*Dall).sum(1)
    good=den>0
    pred[j[good]]=num[good]/den[good]
    nsurv[j]=surv.sum(1)
    if a % 40000==0: print('  %d/%d'%(a,len(vi)),flush=True)

s=valid&np.isfinite(pred)
def line(lbl,sel):
    q=sel&s; n=q.sum()
    if n<50: print('%-14s n=%6d  (부족)'%(lbl,n)); return
    o=D[q].mean()*1e4; p=pred[q].mean()*1e4
    diff=(D[q]-pred[q]); se=diff.std(ddof=1)/np.sqrt(n)*1e4
    print('%-14s n=%7d   관측 %+7.3f   귀무(콜라이더 반영) %+7.3f   차 %+7.3f (SE %.3f, z=%+6.2f)   생존마스크 %.0f/1365'
          %(lbl,n,o,p,diff.mean()*1e4,se,diff.mean()*1e4/se,nsurv[q].mean()))
print('\n=== 🔴 닫힌 형태 열거: 관측 D  vs  콜라이더 반영 귀무 (bp) ===')
line('전체',np.ones(len(D),bool))
print()
for lo,hi,l in [(1,2,'N<=2'),(3,4,'N=3-4'),(5,9,'N=5-9'),(10,29,'N=10-29'),(30,99,'N=30-99'),(100,10**9,'N=100+')]:
    line(l,(nbid>=lo)&(nbid<=hi))
print()
for f,l in [(90,'하한 90'),(88,'하한 88')]:
    line(l,floor==f)
np.savez(r'F:/Project/eat-bid/data/mechanism/_enum_pred.npz',pred=pred,D=D,valid=s,nsurv=nsurv,bid_id=bid_id)
