"""모듈 책임: 후보 쌍 105개를 직접 열거해 최선과 최악 조합의 기대 커트라인 차이를 재고 영분포와 비교한다."""

# 레버 직접 계산: "내가 항상 번호쌍 c 를 고른다면 기대 커트라인이 얼마나 달라지나"
# 인수분해(δ상위2 − δ하위2)·π 를 쓰지 않는다 — δ 의 max/min 은 잡음에 위로 편향된다.
import numpy as np, itertools, sys, time
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,bid_id=P['rate'],P['bid_id']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
V=np.zeros((len(bid_id),15),dtype=np.int32); V[ok]=B['votes_all'][idx[ok]]
nb=np.zeros(len(bid_id),dtype=np.int64); nb[ok]=B['nbid'][idx[ok]]
srt=np.sort(rate,axis=1); safe=ok&(xmax>=srt[:,-4:].mean(1))&(V.sum(1)>=2)
print('안전집합 %d'%safe.sum(),flush=True)

pairs=np.array(list(itertools.combinations(range(15),2)))      # 105
E=np.zeros((105,15),dtype=np.int32)
for i,(a,b) in enumerate(pairs): E[i,a]+=1; E[i,b]+=1
SLOT=np.arange(15)

rng=np.random.default_rng(11)
def own_pair(Vs):     # 내 표 2개를 빼기 위해 실현 가능한 쌍 하나를 뽑는다
    out=np.zeros_like(Vs)
    for i in range(len(Vs)):
        v=Vs[i]; av=np.flatnonzero(v>0)
        if len(av)>=2:
            p=rng.choice(av,2,replace=False); out[i,p[0]]+=1; out[i,p[1]]+=1
        elif len(av)==1: out[i,av[0]]+=min(2,v[av[0]])
    return out

def meanR(sel, rate_mat, reps_mine=True):
    j=np.flatnonzero(sel)
    acc=np.zeros(105); n=0
    CH=1500
    for a in range(0,len(j),CH):
        q=j[a:a+CH]
        Vo=V[q]-(own_pair(V[q]) if reps_mine else 0)
        Vo=np.clip(Vo,0,None)
        C=Vo[:,None,:]+E[None,:,:]                       # (chunk,105,15)
        key=C.astype(np.int32)*16-SLOT[None,None,:]      # 득표↑, 동점은 낮은 슬롯↑
        top=np.argpartition(-key,4,axis=2)[:,:,:4]       # 상위 4 슬롯
        r=np.take_along_axis(rate_mat[q][:,None,:].repeat(105,1),top,axis=2).mean(2)
        acc+=r.sum(0); n+=len(q)
    return acc/n

t=time.time()
obs=meanR(safe,rate)
lev=(obs.max()-obs.min())*1e4
print('관측: 105쌍 중 최선−최악 기대 R 차 = %.4f bp   (%.0f초)'%(lev,time.time()-t),flush=True)
best=pairs[obs.argmin()]+1; worst=pairs[obs.argmax()]+1
print('  가장 낮은 R 을 주는 쌍 %s · 가장 높은 쌍 %s'%(best,worst))

reps=int(sys.argv[1]) if len(sys.argv)>1 else 8
null=[]
for k in range(reps):
    rp=rng.permuted(np.tile(np.arange(15),(len(rate),1)),axis=1)
    rm=np.take_along_axis(rate,rp,axis=1)
    o=meanR(safe,rm); null.append((o.max()-o.min())*1e4)
    print('  null %d/%d = %.4f'%(k+1,reps,null[-1]),flush=True)
null=np.array(null)
print('\n=== 🔴 판정 ===')
print('  관측 레버   %.4f bp'%lev)
print('  영분포      평균 %.4f · sd %.4f · 최대 %.4f  (슬롯↔가격 독립 귀무, %d회)'%(null.mean(),null.std(),null.max(),reps))
print('  → %s'%('영분포 초과' if lev>null.max() else '🔴 영분포 안 — 검출 안 됨'))
print('  승부 창문 5.8 bp 대비: 관측 1/%.0f · 영분포 상한 1/%.0f'%(5.8/lev,5.8/max(null.max(),1e-9)))
