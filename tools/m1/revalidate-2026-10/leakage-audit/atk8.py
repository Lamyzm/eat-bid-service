"""모듈 책임: 회차 선택 없이 하한율 90 전체에 걸어 연도별 무누수 walk-forward 배수를 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']; bid=z['bid_id']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
common,iz,ia=np.intersect1d(bid,a['bid_id'],return_indices=True)
purr=np.full(len(cnt),"?",dtype='<U12'); purr[iz]=np.array(a['purr'])[ia]
kpi=np.array([p+"|"+str(i) for p,i in zip(purr,item)])
def pb_p(p,k):
    poly=np.zeros(len(p)+1); poly[0]=1.0
    for pi in p:
        poly[1:]=poly[1:]*(1-pi)+poly[:-1]*pi; poly[0]*=(1-pi)
    return poly[k:].sum()
rng0=np.random.default_rng(0); al=0.03; ns=400000
lo=rng0.uniform(1-al,1.0,(ns,8)); hi=rng0.uniform(1.0,1+al,(ns,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng0.random((ns,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-al,1+al,401); hh,_=np.histogram(Rsim,bins=edges); w=hh/hh.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.90,1.0151,0.0005)
NMAX=400
def fit(cut):
    TRm=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)&(ym[rounds]<=cut)
    vv=np.sort(x[TRm]); Fg=np.searchsorted(vv,G,side='right')/len(vv); Fm=np.searchsorted(vv,mid,side='right')/len(vv)
    # Pmat[k,N] = P(win | x=G[k], N)
    Pmat=np.zeros((len(G),NMAX+1))
    for k,xv in enumerate(G):
        s2=mid<=xv
        if not s2.any(): continue
        base=(1-Fg[k]+Fm[s2]); ww=w[s2]
        for N in range(1,NMAX+1): Pmat[k,N]=np.sum(ww*base**(N-1))
    hist=(ym<=cut)&(floor==90.0)&(~Rs)
    def bl(keys):
        d={}
        for k2,v2 in zip(keys[hist],nbid[hist]): d.setdefault(k2,[]).append(int(v2))
        return {k2:np.array(v2) for k2,v2 in d.items() if len(v2)>=3}
    A=bl(kpi); B=bl(purr); C=bl(np.array([str(i) for i in item])); GL=nbid[hist]
    def pool(r):
        if kpi[r] in A: return A[kpi[r]]
        if purr[r] in B: return B[purr[r]]
        return C.get(str(item[r]),GL)
    cache={}
    def xstar(r):
        po=pool(r); key=id(po)
        if key in cache: return cache[key]
        cl=np.clip(po,1,NMAX); hN=np.bincount(cl,minlength=NMAX+1).astype(float); hN/=hN.sum()
        EP=Pmat@hN
        res=float(G[int(np.argmax(EP))]); cache[key]=res; return res
    def xpoint(r):
        po=pool(r); N=max(1,min(int(round(np.median(po))),NMAX))
        return float(G[int(np.argmax(Pmat[:,N]))])
    return Pmat,xstar,xpoint
def run(rs,xv_of):
    hit=0;ps=[]
    for r in rs:
        s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r])
        ps.append(1/max(N,1)); xv=xv_of(r)
        if xv is not None and xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    ps=np.array(ps); return hit,ps.sum(),len(rs),pb_p(ps,hit)
for cut,y in [(202412,2025),(202512,2026)]:
    Pmat,xstar,xpoint=fit(cut)
    print(f"=== 테스트 {y} (훈련 ≤{cut}) · floor90 전체, 회차선택 없음")
    for lab,fn in [("점추정 N(중위) 플러그인",xpoint),("N 예측분포 기대최대화",xstar)]:
        rs=np.where((ym//100==y)&(~Rs)&(floor==90.0))[0].tolist()
        h,e,n,p=run(rs,fn)
        print(f"  {lab:24s} 회차{n:6d} 적중{h:5d} 기대{e:8.2f} {h/e:6.3f}배 p={p:.2e}")
        for lo_,hi_ in [(1,9),(10,39),(40,70),(71,100000)]:
            rs2=np.where((ym//100==y)&(~Rs)&(floor==90.0)&(nbid>=lo_)&(nbid<=hi_))[0].tolist()
            h2,e2,n2,p2=run(rs2,fn)
            print(f"      실제N {lo_}-{hi_}: 회차{n2:6d} 적중{h2:5d} 기대{e2:8.2f} {h2/e2:6.3f}배")
    print()
