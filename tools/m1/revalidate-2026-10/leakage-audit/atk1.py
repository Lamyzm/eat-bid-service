"""모듈 책임: 단일 전역 투찰률과 버킷 투찰률의 적중을 단순 1/N·유찰 보정 기대와 비교한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)

def score(rs, xv_of):
    """rs: 회차 index 배열. xv_of: r -> x. 반환 (적중, 기대_단순1/N, 기대_유찰보정, n)"""
    hit=0; e1=0.0; e2=0.0; nowin=0
    for r in rs:
        s,e=starts[r],starts[r]+cnt[r]
        live=~wd[s:e]; o=x[s:e][live]; N=len(o); Rr=float(R[r])
        p=1.0/max(N,1); e1+=min(p,1.0)
        haswin=bool((o>=Rr).any())
        if not haswin: nowin+=1
        e2+= (min(p,1.0) if haswin else 0.0)
        xv=xv_of(r)
        if xv is None: continue
        if xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    return hit,e1,e2,len(rs),nowin

# 단일 글로벌 x (N 조건 없음) — 훈련: 2025-12까지 floor90 전체
# 모형으로 고르되 N은 대표값 하나만 쓰는 대신, 격자 전체를 저장해 사후 분석
a=0.03; rng=np.random.default_rng(0); n=400000
lo=rng.uniform(1-a,1.0,(n,8)); hi=rng.uniform(1.0,1+a,(n,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng.random((n,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
edges=np.linspace(1-a,1+a,401); h,_=np.histogram(Rsim,bins=edges)
w=h/h.sum(); mid=0.5*(edges[:-1]+edges[1:])
G=np.arange(0.975,1.0151,0.0005)
TR=(~wd)&(~Rs[rounds])&(floor[rounds]==90.0)&(ym[rounds]<=202512)
vv=np.sort(x[TR]); Fg=np.searchsorted(vv,G,side='right')/len(vv); Fm=np.searchsorted(vv,mid,side='right')/len(vv)
def bestx(N):
    P=np.zeros(len(G))
    for k,xv in enumerate(G):
        sel=mid<=xv
        P[k]=np.sum(w[sel]*(1-Fg[k]+Fm[sel])**(N-1)) if sel.any() else 0
    return G[int(np.argmax(P))]
xg_all=bestx(52)
print("글로벌 단일 x* (N=52 대표) =",round(float(xg_all),4))
for N in [10,20,30,40,52,70,100,150]:
    print("   N=%3d -> x*=%.4f"%(N,bestx(N)))

te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
print("\n[1] 같은 3438 회차, 단일 글로벌 x=%.4f"%xg_all)
hit,e1,e2,n_,nw=score(te.tolist(), lambda r: xg_all)
print(f"    적중 {hit}  1/N기대 {e1:.2f} -> {hit/e1:.3f}배 | 유찰보정기대 {e2:.2f} -> {hit/e2:.3f}배 | 유찰 {nw}/{n_}")

print("\n[2] N 필터 제거: 2026 floor90 전체 (R_suspect 제외)")
te2=np.where((ym>=202601)&(~Rs)&(floor==90.0))[0]
hit,e1,e2,n_,nw=score(te2.tolist(), lambda r: xg_all)
print(f"    회차 {n_}  적중 {hit}  1/N기대 {e1:.2f} -> {hit/e1:.3f}배 | 유찰보정 {hit/e2:.3f}배 | 유찰 {nw}")

print("\n[3] N 필터·R_suspect 필터 모두 제거: 2026 floor90 전부")
te3=np.where((ym>=202601)&(floor==90.0))[0]
hit,e1,e2,n_,nw=score(te3.tolist(), lambda r: xg_all)
print(f"    회차 {n_}  적중 {hit}  1/N기대 {e1:.2f} -> {hit/e1:.3f}배 | 유찰보정 {hit/e2:.3f}배 | 유찰 {nw}")

print("\n[4] N 구간별 (2026 floor90, 단일 x)")
NN=nbid
for lo_,hi_ in [(1,4),(5,9),(10,19),(20,29),(30,39),(40,49),(50,59),(60,69),(70,99),(100,10000)]:
    rs=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(NN>=lo_)&(NN<=hi_))[0]
    if len(rs)==0: continue
    hit,e1,e2,n_,nw=score(rs.tolist(), lambda r: xg_all)
    print(f"    N {lo_:>4}-{hi_:<5} 회차{n_:5d} 적중{hit:4d} 기대{e1:7.2f} {hit/e1 if e1>0 else 0:6.3f}배  유찰보정{hit/e2 if e2>0 else 0:6.3f}배 유찰{nw}")
