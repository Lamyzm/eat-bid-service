"""모듈 책임: 경쟁자 수 구간별로 전략 지렛대와 오라클 상한, 내 표가 선정을 바꿀 확률을 함께 낸다."""

import numpy as np, itertools, time
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
B=np.load(r'F:/Project/eat-bid/data/mechanism/bids.npz',allow_pickle=True)
rate,bid_id=P['rate'],P['bid_id']
bi={b:i for i,b in enumerate(B['bid_id'])}
idx=np.array([bi.get(b,-1) for b in bid_id]); ok=idx>=0
xmax=np.full(len(bid_id),np.nan); xmax[ok]=B['xmax'][idx[ok]]
V=np.zeros((len(bid_id),15),dtype=np.int32); V[ok]=B['votes_all'][idx[ok]]
nb=np.zeros(len(bid_id),dtype=np.int64); nb[ok]=B['nbid'][idx[ok]]
srt=np.sort(rate,axis=1); safe=ok&(xmax>=srt[:,-4:].mean(1))&(V.sum(1)>=2)
pairs=np.array(list(itertools.combinations(range(15),2)))
E=np.zeros((105,15),dtype=np.int32)
for i,(a,b) in enumerate(pairs): E[i,a]+=1; E[i,b]+=1
SLOT=np.arange(15); rng=np.random.default_rng(11)

def run(sel,rm):
    j=np.flatnonzero(sel); acc=np.zeros(105); orc=0.0; chg=0.0; n=0
    for a in range(0,len(j),1500):
        q=j[a:a+1500]; Vs=V[q]
        own=np.zeros_like(Vs)
        for i in range(len(Vs)):
            av=np.flatnonzero(Vs[i]>0)
            if len(av)>=2:
                p=rng.choice(av,2,replace=False); own[i,p[0]]+=1; own[i,p[1]]+=1
            elif len(av)==1: own[i,av[0]]+=min(2,Vs[i,av[0]])
        Vo=np.clip(Vs-own,0,None)
        C=Vo[:,None,:]+E[None,:,:]
        key=C.astype(np.int32)*16-SLOT[None,None,:]
        top=np.argpartition(-key,4,axis=2)[:,:,:4]
        r=np.take_along_axis(rm[q][:,None,:].repeat(105,1),top,axis=2).mean(2)
        acc+=r.sum(0); orc+=(r.max(1)-r.min(1)).sum()
        chg+=(np.unique(np.sort(top,axis=2),axis=1).shape[1]>1 if False else
              (np.sort(top,axis=2)!=np.sort(top,axis=2)[:,:1,:]).any(2).any(1).sum())
        n+=len(q)
    return acc/n, orc/n*1e4, chg/n

print('%-9s %8s  %10s  %10s  %10s  %9s'%('구간','n','전략레버','영분포','오라클상한','π(내표가 4개를 바꿈)'))
buckets=[(1,10**9,'전체'),(1,2,'N<=2'),(3,4,'N=3-4'),(5,9,'N=5-9'),(10,29,'N=10-29'),(30,99,'N=30-99'),(100,10**9,'N=100+')]
for lo,hi,l in buckets:
    s=safe&(nb>=lo)&(nb<=hi)
    if s.sum()<200: continue
    o,orc,pi=run(s,rate)
    lev=(o.max()-o.min())*1e4
    nl=[]
    for _ in range(4):
        rp=rng.permuted(np.tile(np.arange(15),(len(rate),1)),axis=1)
        oo,_,_=run(s,np.take_along_axis(rate,rp,axis=1)); nl.append((oo.max()-oo.min())*1e4)
    nl=np.array(nl)
    flag='' if lev<=nl.max() else '  <-- 초과'
    print('%-9s %8d  %8.3f bp  %5.3f±%.3f  %8.3f bp  %8.3f%s'%(l,s.sum(),lev,nl.mean(),nl.std(),orc,pi,flag))
