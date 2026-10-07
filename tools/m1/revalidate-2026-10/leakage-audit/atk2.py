"""모듈 책임: 2026년 N 40~70 회차의 특정 투찰률 집중과 동점 특혜 여부를 잰다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
NB=lambda n: np.clip((n-40)//5,0,5)
tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
# ---- 동점 질량 조사
m26=(~wd)&(floor[rounds]==90.0)&(ym[rounds]>=202601)&(nbid[rounds]>=40)&(nbid[rounds]<=70)
xs=x[m26]
print("2026 N40-70 floor90 live 투찰 %d건"%len(xs))
for g in [0.9875,0.9880,0.9890]:
    at=np.isclose(xs,g,atol=5e-7).sum()
    print(f"  x=={g}: {at}건 ({at/len(xs)*100:.3f}%)")
# 소수 3자리 격자 전체의 원형수 집중도
r3=np.round(xs*1000)
print("  x*1000이 정수에 1e-4 이내:", int((np.abs(xs*1000-r3)<1e-4).sum()), "/", len(xs))
print("  상위 집중 투찰률 10개:")
u,c=np.unique(np.round(xs,6),return_counts=True)
o=np.argsort(-c)[:10]
for i in o: print(f"    {u[i]:.6f}  {c[i]}건")

def score(rs,xv_of,tie_lose=False):
    hit=0;e=0.0;tied=0
    for r in rs:
        s,en=starts[r],starts[r]+cnt[r]
        live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r]); e+=1.0/max(N,1)
        xv=xv_of(r)
        if xv<Rr: continue
        blk=(o>=Rr)&(o<xv-1e-9) if not tie_lose else (o>=Rr)&(o<=xv+1e-9)
        if not blk.any():
            hit+=1
            if ((o>=Rr)&(np.abs(o-xv)<1e-6)).any(): tied+=1
    return hit,e,tied
f=lambda r: tbl[NB(int(nbid[r]))]
h,e,ti=score(te.tolist(),f)
print(f"\n[동점 우대] 적중 {h} 기대 {e:.2f} 배수 {h/e:.3f}  그 중 동일 투찰률 경쟁자 존재 {ti}건")
h2,_,_=score(te.tolist(),f,tie_lose=True)
print(f"[동점 패배] 적중 {h2} 배수 {h2/e:.3f}")
# 동점 절반 승
print(f"[동점 절반승 추정] {(h+h2)/2:.1f} 배수 {((h+h2)/2)/e:.3f}")

# ---- Poisson-binomial 검정
from scipy import stats
p=np.array([1.0/max(int((~wd[starts[r]:starts[r]+cnt[r]]).sum()),1) for r in te])
# 정확 Poisson-binomial (DFT)
nR=len(p); K=nR+1
ch=np.ones(1,dtype=np.complex128)
# 다항식 곱
poly=np.zeros(nR+1); poly[0]=1.0
for pi in p:
    poly[1:]=poly[1:]*(1-pi)+poly[:-1]*pi
    poly[0]*= (1-pi)
pv=poly[94:].sum()
print(f"\nPoisson-binomial: 기대 {p.sum():.2f} 분산 {np.sum(p*(1-p)):.2f}")
print(f"  P(X>=94) = {pv:.3e}   (단일 x 88건: P = {poly[88:].sum():.3e})")
print(f"  z = {(94-p.sum())/np.sqrt(np.sum(p*(1-p))):.2f}")
