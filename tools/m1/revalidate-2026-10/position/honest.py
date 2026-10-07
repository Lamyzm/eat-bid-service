"""모듈 책임: 마감 1시간 전 N만으로 코호트와 버킷을 정해 구조식 한 장 투찰의 2026년 봉인 배수를 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
from scipy.stats import norm
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; t=z['t']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
live=~wd
NASOF=np.bincount(rounds[live&(t>=1.0)],minlength=len(cnt))   # 마감 1시간 전 관측
# f_R  (alpha=0.03)
rng=np.random.default_rng(0); a=0.03; n=400000
v=np.concatenate([rng.uniform(1-a,1.0,(n,8)),rng.uniform(1.0,1+a,(n,7))],axis=1)
idx=np.argsort(rng.random((n,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-a,1+a,401); h,_=np.histogram(Rsim,bins=edges)
w=h/h.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.975,1.0151,0.0005)
base=live&(~Rs[rounds])&(floor[rounds]==90.0)
TR=base&(ym[rounds]<=202512)
def bucket(n): return np.clip(n//10,0,14)      # 0-9,10-19,...,140+
tbl={}
for k in range(15):
    m=TR&(bucket(NASOF[rounds])==k)
    if m.sum()<500: continue
    v2=np.sort(x[m])
    Fg=np.searchsorted(v2,G,side='right')/len(v2)
    Fm=np.searchsorted(v2,mid,side='right')/len(v2)
    Nrep=max(k*10+5,2)/0.987                   # 잔여 도착 보정
    P=np.array([np.sum(w[mid<=xv]*(1-Fg[i]+Fm[mid<=xv])**(Nrep-1)) if (mid<=xv).any() else 0
                for i,xv in enumerate(G)])
    tbl[k]=G[int(np.argmax(P))]
print("as-of N 버킷별 선택 투찰률:", {k*10: round(float(v),4) for k,v in sorted(tbl.items())})
for lab,cond in [("floor90 전체",None),("as-of N 40-70",(40,70))]:
    te=np.where((ym>=202601)&(~Rs)&(floor==90.0))[0]
    if cond: te=te[(NASOF[te]>=cond[0])&(NASOF[te]<=cond[1])]
    hit=0; exp=0.0; var=0.0; used=0
    for r in te.tolist():
        xv=tbl.get(bucket(int(NASOF[r])))
        if xv is None: continue
        s,e=starts[r],starts[r]+cnt[r]
        o=x[s:e][live[s:e]]; Rr=float(R[r]); N=len(o)
        if N<1: continue
        used+=1
        if xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
        q=min(1.0/N,1.0); exp+=q; var+=q*(1-q)
    zz=(hit-exp)/var**0.5
    print(f"\n{lab}: {used:,}회차   적중 {hit}  기대 {exp:.1f}  배수 {hit/exp:.3f}  z={zz:+.2f}  p={2*norm.sf(abs(zz)):.2e}")
