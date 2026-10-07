"""모듈 책임: 점유 간격·회차 내 백분위·x-R 가운데 무엇이 다음 기간 낙찰 배수를 설명하는지 순위상관으로 비교한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
from scipy.stats import spearmanr
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); f=np.load("gapfeat.npz")
cnt=z['off']; win=z['is_recorded_winner']; nbid=z['nbid']; ym=z['ym']; biz=z['biz_no']
ymb=np.repeat(ym,cnt); nb=np.repeat(nbid,cnt).astype(np.float64)
gap=f['gap']; pct=f['pct']; dR=f['dR']
ok=np.isfinite(gap)
DEF=ok&(ymb<=202512); MEA=ok&(ymb>=202601)
ub,inv=np.unique(biz,return_inverse=True)
def agg(mask,vals):
    s=np.bincount(inv[mask],weights=vals[mask].astype(np.float64),minlength=len(ub))
    c=np.bincount(inv[mask],minlength=len(ub))
    return s,c
g_s,d_c=agg(DEF,gap); p_s,_=agg(DEF,pct); r_s,_=agg(DEF,dR)
w_s,m_c=agg(MEA,win.astype(np.float64)); e_s,_=agg(MEA,1.0/nb)
sel=(d_c>=20)&(m_c>=20)&(e_s>0)
print(f"대상 사업자 {int(sel.sum()):,}  (문서 §11은 2,250)")
mult=w_s[sel]/e_s[sel]
feats={"점유 간격(정의기간 평균)":g_s[sel]/d_c[sel],
       "회차 내 x 백분위":p_s[sel]/d_c[sel],
       "x - R":r_s[sel]/d_c[sel]}
print(f"\n{'변수':28s} {'rho':>9} {'p':>12}")
for k,v in feats.items():
    rho,pv=spearmanr(v,mult)
    print(f"{k:28s} {rho:+9.4f} {pv:12.2e}")
print(f"\n문서 §11 보고값:  x 백분위 -0.2389 (p=1.5e-30) · x-R -0.1572 (p=6.5e-14)")
