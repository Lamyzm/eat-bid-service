"""모듈 책임: 기관×품목 과거 중위 N으로 참여 수를 예측해 그 정밀도와 코호트 선택 결과를 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']; item=z['item']; bid=z['bid_id']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
# purr, sido 를 bid_id 로 조인
purr=np.full(len(cnt),"",dtype=object); sido=np.full(len(cnt),"",dtype=object)
common,iz,ia=np.intersect1d(bid,a['bid_id'],return_indices=True)
P=np.array(a['purr']); S=np.array(a['sido'])
purr=np.full(len(cnt),"?",dtype='<U12'); purr[iz]=P[ia]
sido=np.full(len(cnt),"?",dtype='<U3');  sido[iz]=S[ia]
print("purr 매칭 회차 %d / %d"%(len(iz),len(cnt)))

# ---- N 예측 (2025-12 이전 정보만): purr 중위 N -> (purr,item) -> item -> 전체
hist=(ym<=202512)&(floor==90.0)&(~Rs)
def build(keys):
    d={}
    for k,v in zip(keys[hist],nbid[hist]): d.setdefault(k,[]).append(v)
    return {k:float(np.median(v)) for k,v in d.items() if len(v)>=3}
mp_pi=build(np.array([p+"|"+str(i) for p,i in zip(purr,item)]))
mp_p =build(purr)
mp_i =build(np.array([str(i) for i in item]))
glob=float(np.median(nbid[hist]))
def predN(r):
    k=purr[r]+"|"+str(item[r])
    if k in mp_pi: return mp_pi[k]
    if purr[r] in mp_p: return mp_p[purr[r]]
    if str(item[r]) in mp_i: return mp_i[str(item[r])]
    return glob
te_all=np.where((ym>=202601)&(~Rs)&(floor==90.0))[0]
pN=np.array([predN(r) for r in te_all]); aN=nbid[te_all].astype(float)
print("\nN 예측 성능 (2026 floor90 %d회차)"%len(te_all))
print("  Spearman r=%.3f  |오차| 중위 %.1f  MAE %.1f"%(
    __import__('scipy.stats',fromlist=['x']).spearmanr(pN,aN).statistic,
    np.median(np.abs(pN-aN)), np.abs(pN-aN).mean()))
sel=(pN>=40)&(pN<=70); act=(aN>=40)&(aN<=70)
print("  예측 N∈[40,70] 회차 %d  그 중 실제 N∈[40,70] %d (정밀도 %.1f%%)  재현율 %.1f%%"%(
    sel.sum(), (sel&act).sum(), 100*(sel&act).sum()/max(sel.sum(),1), 100*(sel&act).sum()/act.sum()))

NB=lambda n: int(np.clip((n-40)//5,0,5))
tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
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
print("\n[E] 회차 선택을 '예측 N'으로 바꿈 (x도 예측 N 버킷)")
rs=te_all[sel].tolist()
h,e,n,p=run(rs,lambda r: tbl[NB(predN(r))])
print(f"  예측선택: 회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배 p={p:.2e}")
print("\n[F] 오라클 N 선택 + 예측 N으로 x (x의 누수만 제거)")
rs=te_all[act].tolist()
h,e,n,p=run(rs,lambda r: tbl[NB(predN(r))])
print(f"  회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배 p={p:.2e}")
print("\n[G] 오라클 N 선택 + 단일 상수 x=0.9880")
h,e,n,p=run(rs,lambda r: 0.9880)
print(f"  회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배 p={p:.2e}")
print("\n[H] 예측 N 선택 + 단일 상수 x=0.9880")
rs2=te_all[sel].tolist()
h,e,n,p=run(rs2,lambda r: 0.9880)
print(f"  회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배 p={p:.2e}")
print("\n[I] 선택 없음(2026 floor90 전부) + 오라클 N 적응 x")
# 훈련에서 N별 최적 x 정밀 테이블
rng=np.random.default_rng(0); al=0.03; ns=400000
lo=rng.uniform(1-al,1.0,(ns,8)); hi=rng.uniform(1.0,1+al,(ns,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng.random((ns,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-al,1+al,401); hh,_=np.histogram(Rsim,bins=edges); w=hh/hh.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.90,1.0151,0.0005)
TRm=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)&(ym[rounds]<=202512)
vv=np.sort(x[TRm]); Fg=np.searchsorted(vv,G,side='right')/len(vv); Fm=np.searchsorted(vv,mid,side='right')/len(vv)
def bestx(N):
    Pp=np.zeros(len(G))
    for k,xv in enumerate(G):
        s2=mid<=xv
        Pp[k]=np.sum(w[s2]*(1-Fg[k]+Fm[s2])**(N-1)) if s2.any() else 0
    return float(G[int(np.argmax(Pp))])
xbyN={N:bestx(N) for N in range(1,301)}
print("   N별 최적x 예:", {N:xbyN[N] for N in [1,2,3,5,10,20,50,100,200]})
h,e,n,p=run(te_all.tolist(), lambda r: xbyN[min(int(nbid[r]),300)] if nbid[r]>=1 else None)
print(f"  회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배")
print("\n[J] 선택 없음 + 예측 N 적응 x (완전 무누수)")
h,e,n,p=run(te_all.tolist(), lambda r: xbyN[max(1,min(int(round(predN(r))),300))])
print(f"  회차{n} 적중{h} 기대{e:.2f} {h/e:.3f}배")
