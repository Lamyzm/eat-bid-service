"""모듈 책임: 최종 N으로 코호트와 경쟁자 분포 버킷을 고른 원래 1.442배 주장을 재현하며, 최종 N 누수가 든 판본으로 보존한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
base=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)
print("floor=90 투찰:",int(base.sum()))
# f_R : alpha=0.03 생성기 (파라미터 0개, 투찰 전 가용)
rng=np.random.default_rng(0); a=0.03; n=400000
lo=rng.uniform(1-a,1.0,(n,8)); hi=rng.uniform(1.0,1+a,(n,7))
v=np.concatenate([lo,hi],axis=1)
idx=np.argsort(rng.random((n,15)),axis=1)[:,:4]
Rs_=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-a,1+a,401); h,_=np.histogram(Rs_,bins=edges)
w=h/h.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.975,1.0151,0.0005)
def fx_cdf(mask):
    v=np.sort(x[mask])
    if len(v)<300: return None
    return (np.searchsorted(v,G,side='right')/len(v),
            np.searchsorted(v,mid,side='right')/len(v))
def best_x(Fg,Fm,N):
    P=np.zeros(len(G))
    for k,xv in enumerate(G):
        sel=mid<=xv
        if not sel.any(): continue
        P[k]=np.sum(w[sel]*(1-Fg[k]+Fm[sel])**(N-1))
    return G[int(np.argmax(P))], P.max()
TR=base&(ym[rounds]<=202512); TR25=base&(ym[rounds]>=202501)&(ym[rounds]<=202512)
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
NB=lambda n: np.clip((n-40)//5,0,5)
variants={}
for name,trm,extra in [("A: N만·전기간(현행)",TR,None),
                       ("B: N만·2025년만",TR25,None),
                       ("C: N+품목·2025년만",TR25,"item")]:
    tbl={}
    for nb in range(6):
        for it in ([None] if extra is None else list(range(10))):
            m=trm&(NB(nbid[rounds])==nb)
            if it is not None: m=m&(item[rounds]==it)
            f=fx_cdf(m)
            if f is None: continue
            N=40+nb*5+2
            tbl[(nb,it)]=best_x(f[0],f[1],N)[0]
    variants[name]=(tbl,extra)
print(f"\n채점 2026 · floor90 · N40-70 · {len(te):,}회차")
print(f"{'변형':>22} {'낙찰':>5} {'낙찰률':>8} {'기준선대비':>9}")
exp=0.0
for r in te.tolist():
    s,e=starts[r],starts[r]+cnt[r]; N=int((~wd[s:e]).sum()); exp+=min(1.0/max(N,1),1)
for name,(tbl,extra) in variants.items():
    hit=0
    for r in te.tolist():
        s,e=starts[r],starts[r]+cnt[r]
        key=(NB(int(nbid[r])), None if extra is None else int(item[r]))
        xv=tbl.get(key) or tbl.get((NB(int(nbid[r])),None))
        if xv is None: continue
        live=~wd[s:e]; o=x[s:e][live]; Rr=float(R[r])
        if xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    print(f"{name:>22} {hit:5d} {hit/len(te)*100:7.2f}% {hit/exp:8.3f}배")
print(f"{'제비뽑기 1장':>22} {exp:5.0f} {exp/len(te)*100:7.2f}%    1.000배")
