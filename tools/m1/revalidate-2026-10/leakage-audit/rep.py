"""모듈 책임: 원래 1.442배 주장의 버킷별 선택 투찰률과 채점을 재현한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
base=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)
rng=np.random.default_rng(0); a=0.03; n=400000
lo=rng.uniform(1-a,1.0,(n,8)); hi=rng.uniform(1.0,1+a,(n,7))
v=np.concatenate([lo,hi],axis=1)
idx=np.argsort(rng.random((n,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-a,1+a,401); h,_=np.histogram(Rsim,bins=edges)
w=h/h.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.975,1.0151,0.0005)
def fx_cdf(mask):
    v=np.sort(x[mask])
    if len(v)<300: return None
    return (np.searchsorted(v,G,side='right')/len(v), np.searchsorted(v,mid,side='right')/len(v))
def best_x(Fg,Fm,N):
    P=np.zeros(len(G))
    for k,xv in enumerate(G):
        sel=mid<=xv
        if not sel.any(): continue
        P[k]=np.sum(w[sel]*(1-Fg[k]+Fm[sel])**(N-1))
    return G[int(np.argmax(P))], P.max()
TR=base&(ym[rounds]<=202512)
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
NB=lambda n: np.clip((n-40)//5,0,5)
tbl={}
for nb in range(6):
    m=TR&(NB(nbid[rounds])==nb)
    f=fx_cdf(m)
    N=40+nb*5+2
    tbl[nb]=(best_x(f[0],f[1],N), int(m.sum()))
print("2026 ym:",np.unique(ym[te]))
print("회차 %d"%len(te))
print("\n버킷별 선택 x")
for nb in range(6):
    (xv,p),nn=tbl[nb]
    print(f"  N{40+nb*5}-{44+nb*5}: x*={xv:.4f}  P모형={p:.4f}  훈련투찰={nn:,}  테스트회차={int((NB(nbid[te])==nb).sum())}")
# 재현
exp=0.0; hit=0; hits=[]
pr=[]
for r in te.tolist():
    s,e=starts[r],starts[r]+cnt[r]; N=int((~wd[s:e]).sum())
    exp+=min(1.0/max(N,1),1); pr.append(1.0/max(N,1))
    xv=tbl[NB(int(nbid[r]))][0][0]
    live=~wd[s:e]; o=x[s:e][live]; Rr=float(R[r])
    hv = (xv>=Rr) and not ((o>=Rr)&(o<xv)).any()
    hit+=hv; hits.append(hv)
print(f"\n재현: 적중 {hit}  기대 {exp:.2f}  배수 {hit/exp:.3f}")
np.save("te.npy",te); np.save("hits.npy",np.array(hits)); np.save("pr.npy",np.array(pr))
np.save("w.npy",w); np.save("mid.npy2.npy",mid)
