import numpy as np, sys
sys.path.insert(0,r'F:/Project/eat-bid-service/tools/synth')
import generator as G

z=np.load(r'F:/Project/eat-bid/data/mechanism/xcap.npz',allow_pickle=True)
xall,cnt,nb=z['x'].astype(np.float64),z['off'],z['nbid']
aid=np.repeat(np.arange(len(nb)),cnt)
BK=[(1,2),(3,4),(5,9),(10,29),(30,99),(100,10**9)]
LB=['N<=2','N=3-4','N=5-9','N=10-29','N=30-99','N=100+']
POOL=[xall[((nb>=lo)&(nb<=hi))[aid]] for lo,hi in BK]
def bucket(n):
    out=np.zeros(len(n),dtype=np.int64)
    for i,(lo,hi) in enumerate(BK): out[(n>=lo)&(n<=hi)]=i
    return out

REAL={'N<=2':-1.241,'N=3-4':-4.868,'N=5-9':-2.371,'N=10-29':-2.284,'N=30-99':-0.933,'N=100+':-0.709}

def run(n=150000,seed=11,filt=True):
    rng=np.random.default_rng(seed)
    rate=G.draw_candidates(n,rng)
    nv=np.maximum(rng.choice(G.NVOTER_EMP,size=n),1).astype(np.int64)
    V=G.draw_votes(n,nv,rng); chosen,_=G.select_four(V,rng)
    R=(rate*chosen).sum(1)/4.0; m=rate.mean(1)
    b=bucket(nv)
    # 회차별로 그 N 구간의 실측 x 분포에서 nv 개를 뽑아 최댓값을 잡는다
    xmax=np.empty(n)
    for i in range(len(BK)):
        q=np.flatnonzero(b==i)
        if not len(q): continue
        mx=int(nv[q].max()); P=POOL[i]
        draw=P[rng.integers(0,len(P),size=(len(q),mx))]
        live=np.arange(mx)[None,:]<nv[q][:,None]
        xmax[q]=np.where(live,draw,-np.inf).max(1)
    keep=(xmax>=R) if filt else np.ones(n,bool)
    return R[keep],m[keep],nv[keep],keep.mean()

for filt in (False,True):
    R,m,nv,kr=run(filt=filt)
    D=(R-m)*1e4; b=bucket(nv)
    lab='필터 켬' if filt else '필터 끔'
    print('%s  전체 %+.3f bp  생존 %.4f'%(lab,D.mean(),kr))
    if filt:
        print('  %-9s %8s %9s %9s %8s'%('구간','n','합성','실측','차'))
        for i,l in enumerate(LB):
            q=b==i
            if q.sum()<50: continue
            print('  %-9s %8d %9.3f %9.3f %8.3f'%(l,q.sum(),D[q].mean(),REAL[l],D[q].mean()-REAL[l]))
