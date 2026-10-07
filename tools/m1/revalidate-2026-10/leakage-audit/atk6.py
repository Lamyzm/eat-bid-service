"""모듈 책임: 합법 투찰률 범위와 월별 배수, 한 달 제외 민감도를 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']; bid=z['bid_id']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
common,iz,ia=np.intersect1d(bid,a['bid_id'],return_indices=True)
purr=np.full(len(cnt),"?",dtype='<U12'); purr[iz]=np.array(a['purr'])[ia]
print("합법 투찰률 범위: min %.4f max %.4f  >1.015 비율 %.3f%%"%(x.min(),x.max(),100*(x>1.015).mean()))
def pb_p(p,k):
    poly=np.zeros(len(p)+1); poly[0]=1.0
    for pi in p:
        poly[1:]=poly[1:]*(1-pi)+poly[:-1]*pi; poly[0]*=(1-pi)
    return poly[k:].sum()
def run(rs,xv_of):
    hit=0; ps=[]
    for r in rs:
        s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r])
        ps.append(1.0/max(N,1)); xv=xv_of(r)
        if xv is not None and xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    ps=np.array(ps); return hit,ps.sum(),len(rs),pb_p(ps,hit)
# ---- 무누수 전략 (walk-forward): cutoff 이전만으로 predN + F_X + xbyN
rng0=np.random.default_rng(0); al=0.03; ns=400000
lo=rng0.uniform(1-al,1.0,(ns,8)); hi=rng0.uniform(1.0,1+al,(ns,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng0.random((ns,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-al,1+al,401); hh,_=np.histogram(Rsim,bins=edges); w=hh/hh.sum(); mid=0.5*(edges[:-1]+edges[1:])
def strat(cut,gmax):
    G=np.arange(0.90,gmax+1e-9,0.0005)
    TRm=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)&(ym[rounds]<=cut)
    vv=np.sort(x[TRm]); Fg=np.searchsorted(vv,G,side='right')/len(vv); Fm=np.searchsorted(vv,mid,side='right')/len(vv)
    tab={}
    for N in range(1,401):
        P=np.zeros(len(G))
        for k,xv in enumerate(G):
            s2=mid<=xv
            P[k]=np.sum(w[s2]*(1-Fg[k]+Fm[s2])**(N-1)) if s2.any() else 0
        tab[N]=float(G[int(np.argmax(P))])
    hist=(ym<=cut)&(floor==90.0)&(~Rs)
    def build(keys):
        d={}
        for k2,vv2 in zip(keys[hist],nbid[hist]): d.setdefault(k2,[]).append(vv2)
        return {k2:float(np.median(v2)) for k2,v2 in d.items() if len(v2)>=3}
    kpi=np.array([p+"|"+str(i) for p,i in zip(purr,item)])
    mp_pi=build(kpi); mp_p=build(purr); mp_i=build(np.array([str(i) for i in item])); gl=float(np.median(nbid[hist]))
    def predN(r):
        k2=kpi[r]
        if k2 in mp_pi: return mp_pi[k2]
        if purr[r] in mp_p: return mp_p[purr[r]]
        return mp_i.get(str(item[r]),gl)
    return tab,predN
print("\n[O] 무누수 walk-forward: 선택 없음, 예측 N 적응 x, floor90 전부")
for cut,lo_,hi_,gmax in [(202412,202501,202512,1.015),(202512,202601,202699,1.015),
                         (202412,202501,202512,1.10),(202512,202601,202699,1.10)]:
    tab,predN=strat(cut,gmax)
    rs=np.where((ym>=lo_)&(ym<=hi_)&(~Rs)&(floor==90.0))[0].tolist()
    h,e,n,p=run(rs, lambda r: tab[max(1,min(int(round(predN(r))),400))])
    print(f"  훈련≤{cut} 테스트 {lo_}~  격자상한 {gmax}: 회차{n:6d} 적중{h:5d} 기대{e:8.2f} {h/e:6.3f}배 p={p:.2e}")
print("\n[P] 무누수 + 오라클 N (비교용)")
for cut,lo_,hi_,gmax in [(202512,202601,202699,1.015),(202512,202601,202699,1.10)]:
    tab,predN=strat(cut,gmax)
    rs=np.where((ym>=lo_)&(ym<=hi_)&(~Rs)&(floor==90.0))[0].tolist()
    h,e,n,p=run(rs, lambda r: tab[max(1,min(int(nbid[r]),400))])
    print(f"  격자상한 {gmax}: 회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배 p={p:.2e}")
# ---- leave-one-month-out
NB=lambda n:int(np.clip((n-40)//5,0,5)); tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
print("\n[Q] 한 달 제외 민감도 (원 주장)")
for m in np.unique(ym[te]):
    rs=te[ym[te]!=m].tolist(); h,e,n,p=run(rs, lambda r: tbl[NB(int(nbid[r]))])
    print(f"  {m} 제외: 회차{n:5d} 적중{h:4d} 기대{e:7.2f} {h/e:6.3f}배 p={p:.2e}")
