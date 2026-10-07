"""모듈 책임: 투찰 분포의 쓰레기값과 유효 범위 재계수가 N과 배수에 주는 영향을 잰다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']; bid=z['bid_id']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
common,iz,ia=np.intersect1d(bid,a['bid_id'],return_indices=True)
purr=np.full(len(cnt),"?",dtype='<U12'); purr[iz]=np.array(a['purr'])[ia]
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
m=(~wd)&np.isin(rounds,te)
xs=x[m]
print("[R] 3438 회차의 live 투찰 %d건 분포 위생"%len(xs))
for lo_,hi_,lab in [(-1,0.90,"x<0.90"),(0.90,0.95,"0.90-0.95"),(0.95,0.97,"0.95-0.97"),
                    (0.97,1.03,"0.97-1.03(R 구간)"),(1.03,1.10,"1.03-1.10"),(1.10,1e9,"x>=1.10")]:
    c=((xs>=lo_)&(xs<hi_)).sum(); print(f"   {lab:18s} {c:7d}  {100*c/len(xs):6.2f}%")
print("   x==0 건수:",int((xs==0).sum()))
def pb_p(p,k):
    poly=np.zeros(len(p)+1); poly[0]=1.0
    for pi in p:
        poly[1:]=poly[1:]*(1-pi)+poly[:-1]*pi; poly[0]*=(1-pi)
    return poly[k:].sum()
NB=lambda n:int(np.clip((n-40)//5,0,5)); tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
# 쓰레기 투찰(x<0.90 또는 x>1.10) 제외한 N 으로 기준선 재계산
hit=0;e_raw=0.0;e_cln=0.0;ps=[]
for r in te.tolist():
    s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]
    ok=(o>=0.90)&(o<=1.10); Nr=len(o); Nc=int(ok.sum()); Rr=float(R[r])
    e_raw+=1/max(Nr,1); e_cln+=1/max(Nc,1); ps.append(1/max(Nc,1))
    xv=tbl[NB(int(nbid[r]))]
    if xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
print(f"\n[S] 기준선 재계산: 적중{hit}  원기대{e_raw:.2f}({hit/e_raw:.3f}배)  유효투찰만{e_cln:.2f}({hit/e_cln:.3f}배) p={pb_p(np.array(ps),hit):.2e}")
# ---- 2025 홀드아웃: 오라클 N / N창별
rng0=np.random.default_rng(0); al=0.03; ns=400000
lo=rng0.uniform(1-al,1.0,(ns,8)); hi=rng0.uniform(1.0,1+al,(ns,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng0.random((ns,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-al,1+al,401); hh,_=np.histogram(Rsim,bins=edges); w=hh/hh.sum(); mid=0.5*(edges[:-1]+edges[1:])
def table(cut,gmax=1.015):
    G=np.arange(0.90,gmax+1e-9,0.0005)
    TRm=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)&(ym[rounds]<=cut)
    vv=np.sort(x[TRm]); Fg=np.searchsorted(vv,G,side='right')/len(vv); Fm=np.searchsorted(vv,mid,side='right')/len(vv)
    t={}
    for N in range(1,401):
        P=np.zeros(len(G))
        for k,xv in enumerate(G):
            s2=mid<=xv; P[k]=np.sum(w[s2]*(1-Fg[k]+Fm[s2])**(N-1)) if s2.any() else 0
        t[N]=float(G[int(np.argmax(P))])
    return t
def run(rs,xv_of):
    hit=0;ps=[]
    for r in rs:
        s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r])
        ps.append(1/max(N,1)); xv=xv_of(r)
        if xv is not None and xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    ps=np.array(ps); return hit,ps.sum(),len(rs),pb_p(ps,hit)
print("\n[T] 오라클 N 적응 x · 연도·N구간별 (훈련은 각 테스트 직전까지)")
for cut,y in [(202312,2024),(202412,2025),(202512,2026)]:
    t=table(cut)
    for lo_,hi_ in [(1,9),(10,39),(40,70),(71,100000),(1,100000)]:
        rs=np.where((ym//100==y)&(~Rs)&(floor==90.0)&(nbid>=lo_)&(nbid<=hi_))[0].tolist()
        if len(rs)<50: continue
        h,e,n,p=run(rs,lambda r: t[max(1,min(int(nbid[r]),400))])
        print(f"  {y} N{lo_}-{hi_}: 회차{n:6d} 적중{h:5d} 기대{e:8.2f} {h/e:6.3f}배 p={p:.2e}")
    print()
