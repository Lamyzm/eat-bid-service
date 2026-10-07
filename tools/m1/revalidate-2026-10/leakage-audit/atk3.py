"""모듈 책임: N 창과 사후 최적 상수에 대한 배수 민감도를 잰다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
NB=lambda n: np.clip((n-40)//5,0,5)
tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
def pb_p(p,k):
    poly=np.zeros(len(p)+1); poly[0]=1.0
    for pi in p:
        poly[1:]=poly[1:]*(1-pi)+poly[:-1]*pi; poly[0]*=(1-pi)
    return poly[k:].sum()
def run(rs,xv_of):
    hit=0;ps=[]
    for r in rs:
        s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r])
        ps.append(1.0/max(N,1)); xv=xv_of(r)
        if xv is not None and xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    ps=np.array(ps); return hit,ps.sum(),len(rs),ps
f=lambda r: tbl[NB(int(nbid[r]))]
print("[A] N 창 민감도 (2026 floor90, 버킷 x)")
print(f"{'창':>12} {'회차':>6} {'적중':>5} {'기대':>8} {'배수':>7} {'p':>10}")
for lo,hi in [(40,70),(35,70),(30,70),(45,70),(40,60),(40,80),(40,100),(30,100),(20,100),(10,10000),(1,10000),(50,70),(55,75),(25,45)]:
    rs=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=lo)&(nbid<=hi))[0]
    h,e,n,ps=run(rs.tolist(),f)
    print(f"{str((lo,hi)):>12} {n:6d} {h:5d} {e:8.2f} {h/e:7.3f} {pb_p(ps,h):10.2e}")
print("\n[B] floor 민감도 (2026, N40-70, 버킷 x)")
for fl in np.unique(floor[(ym>=202601)]):
    rs=np.where((ym>=202601)&(~Rs)&(floor==fl)&(nbid>=40)&(nbid<=70))[0]
    if len(rs)<30: continue
    h,e,n,ps=run(rs.tolist(),f)
    print(f"  floor={fl:<8g} 회차{n:5d} 적중{h:4d} 기대{e:7.2f} {h/e:6.3f}배 p={pb_p(ps,h):.2e}")
print("\n[C] 연도 민감도: 같은 전략을 과거 연도에 (F_X는 그 해 이전만 쓰는 게 아니라 동일 x 적용)")
for y in [2023,2024,2025,2026]:
    rs=np.where((ym//100==y)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
    if len(rs)<50: continue
    h,e,n,ps=run(rs.tolist(),f)
    print(f"  {y} 회차{n:5d} 적중{h:4d} 기대{e:7.2f} {h/e:6.3f}배 p={pb_p(ps,h):.2e}")
print("\n[D] 2026 N40-70에서 격자 전체 곡선 (사후 최적 x는?)")
rs=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0].tolist()
G=np.arange(0.975,1.0151,0.0005)
res=[]
for xv in G:
    h,e,n,ps=run(rs,lambda r,xv=xv: float(xv)); res.append((xv,h,h/e))
bestpost=max(res,key=lambda t:t[1])
for xv,h,m in res:
    bar="#"*int(h/3)
    mark=" <-선택" if abs(xv-0.988)<1e-9 else (" <-사후최적" if xv==bestpost[0] else "")
    print(f"  x={xv:.4f} 적중{h:4d} {m:6.3f}배 {bar}{mark}")
