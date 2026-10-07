"""모듈 책임: 업체별 1/N z 분포와 기간 간 지속성을 내며, 메커니즘 귀무로 철회된 실력 주장의 재현본이다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
from scipy.stats import spearmanr
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; win=z['is_recorded_winner']; wd=z['wd']; ym=z['ym']; biz=z['biz_no']; Rs=z['R_suspect']
rounds=np.repeat(np.arange(len(cnt)),cnt)
live=~wd
Nl=np.bincount(rounds[live],minlength=len(cnt))          # 회차별 유효 투찰 수
ok=live&(~Rs[rounds])&(Nl[rounds]>0)
p=np.where(ok,1.0/np.maximum(Nl[rounds],1),0.0)
ub,inv=np.unique(biz,return_inverse=True)
def stats(mask):
    e=np.bincount(inv[mask],weights=p[mask],minlength=len(ub))
    v=np.bincount(inv[mask],weights=(p*(1-p))[mask],minlength=len(ub))
    a=np.bincount(inv[mask],weights=win[mask].astype(float),minlength=len(ub))
    c=np.bincount(inv[mask],minlength=len(ub))
    return e,v,a,c
E,V,A,C=stats(ok)
sel=C>=100
Z=(A[sel]-E[sel])/np.sqrt(np.maximum(V[sel],1e-9))
print(f"업체 {int(sel.sum()):,}개 (투찰 100건 이상)")
print(f"z 분포:  평균 {Z.mean():+.3f}   sd {Z.std():.3f}   ← 순수 운이면 sd=1.0")
print(f"   문서 주장 sd=2.41")
for q in [1,5,25,50,75,95,99]: print(f"   {q:2d}%분위 {np.percentile(Z,q):+6.2f}")
F=['3118152843','7175001228']
for f in F:
    i=np.where(ub==f)[0]
    if len(i) and sel[i[0]]:
        k=int(sel[:i[0]].sum()); print(f"\n{f}: z={Z[k]:+.2f}  백분위 {(Z<Z[k]).mean()*100:.1f}%")
# 지속성
D=ok&(ym[rounds]<=202512); M=ok&(ym[rounds]>=202601)
E1,V1,A1,C1=stats(D); E2,V2,A2,C2=stats(M)
s2=(C1>=100)&(C2>=50)&(V1>0)&(V2>0)
z1=(A1[s2]-E1[s2])/np.sqrt(V1[s2]); z2=(A2[s2]-E2[s2])/np.sqrt(V2[s2])
rho,pv=spearmanr(z1,z2)
print(f"\n지속성: 정의기간 z vs 측정기간 z   업체 {int(s2.sum()):,}  rho={rho:+.4f}  p={pv:.2e}")
print(f"   문서 주장 rho=+0.241")
