"""모듈 책임: 규칙 2026-10-10(두 하한율·여섯 대역)을 마감 h시간 전 참여 수와 보정표로 고를 때의 적용 범위·대역 일치·공정 배수를 2026-01~08로 내 계산기가 금액을 낼 최대 선행 시간을 정한다."""
import numpy as np, sys, io, json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; Rs=z['R_suspect']; floor=z['floor']
rounds=np.repeat(np.arange(len(cnt)),cnt)
gt=json.load(open("growth2.json",encoding="utf-8"))
def ratio(fl,h,n):
    rows=gt["floors"][fl]
    for r in rows:
        if r["from"]<=h<r["to"]:
            for (lo,hi),c in zip(gt["counts"],r["ratios"]):
                if lo<=n<(hi or 10**9): return c if c else 1.0
    return None
for fl in ("90","88"):
    rule=json.load(open(f"rule{fl}_fair.json",encoding="utf-8"))
    d=np.load(f"winmat{fl}.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
    sel=np.where((~Rs)&(floor==float(fl))&(cnt>=2))[0]; assert len(sel)==len(M)
    col=lambda v:int(np.argmin(np.abs(G-float(v))))
    bands=[(b["lo"],b["hi"] or 10**6,[p["multiple"] for p in b["positions"]]) for b in rule["bands"]]
    def band_of(n):
        for i,(lo,hi,_) in enumerate(bands):
            if lo<=n<=hi: return i
        return -1
    te=(YM>=202601)&(YM<=202608)
    def score(bidx,k):
        m=te&(bidx>=0); w=np.zeros(m.sum(),bool); bb=bidx[m]; X=M[m]
        for i,(_,_,vals) in enumerate(bands):
            mm=bb==i
            for j in range(k): w[mm]|=X[mm][:,col(vals[j])]
        return m.sum(), w.sum(), (k/(NT[m]+k)).sum()
    b1=np.array([band_of(n) for n in NA])
    n0,w0,l0=score(b1,2)
    print(f"하한율 {fl}: 마감 1h 전 기준 두 장 {w0}/{l0:.1f} = {w0/l0:.3f}배 ({n0:,}회차)")
    for h in [3,6,9,12,15,18,21,24,36]:
        nh=np.bincount(rounds[t>=h],minlength=len(cnt))[sel]
        est=np.array([round(n*(ratio(fl,h,n) or 1.0)) if n>0 else 0 for n in nh])
        bh=np.array([band_of(n) for n in est])
        n,w,l=score(bh,2); agree=((bh==b1)&te&(b1>=0)).sum()/(te&(b1>=0)).sum()
        print(f"   {h:>2}h 전: 적용 {n/n0*100:5.1f}% · 대역일치 {agree*100:5.1f}% · 두 장 {w/l:.3f}배")
