"""모듈 책임: 규칙 2026-10-10의 두 장 성적을 기초금액 크기별로 나누고, 낙찰 건수가 아니라 낙찰 기초금액 합으로도 공정한 운과 비교한다(2026-01~08)."""
import numpy as np, sys, io, json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; Rs=z['R_suspect']; floor=z['floor']; bid=z['bid_id']
p=np.load("F:/Project/eat-bid/data/mechanism/plist.npz",allow_pickle=True)
base_by=dict(zip(p['bid_id'].tolist(),p['bgng'].tolist()))
print("기초금액 예시:", [base_by[b] for b in bid[:3]])
SIZE=[(0,5e6,"500만 미만"),(5e6,1e7,"500만~1천만"),(1e7,2e7,"1천만~2천만"),(2e7,5e7,"2천만~5천만"),(5e7,1e15,"5천만 이상")]
for fl in ("90","88"):
    rule=json.load(open(f"rule{fl}_fair.json",encoding="utf-8"))
    d=np.load(f"winmat{fl}.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
    sel=np.where((~Rs)&(floor==float(fl))&(cnt>=2))[0]
    base=np.array([float(base_by.get(b,np.nan)) for b in bid[sel]])
    col=lambda v:int(np.argmin(np.abs(G-float(v))))
    te=(YM>=202601)&(YM<=202608)
    win=np.zeros(len(M),bool); covered=np.zeros(len(M),bool)
    for b in rule["bands"]:
        m=(NA>=b["lo"])&(NA<=(b["hi"] or 10**6)); covered|=m
        for p_ in b["positions"][:2]: win[m]|=M[m][:,col(p_["multiple"])]
    lot=2/(NT+2)
    print(f"\n하한율 {fl} (2026-01~08, 두 장, 대역 2곳 이상)")
    print(f"  {'기초금액':<12} {'회차':>6} {'건수 배수':>8} {'금액 배수':>8} {'규칙 낙찰 금액':>14} {'운 기대 금액':>12}")
    for lo,hi,lab in SIZE:
        m=te&covered&(base>=lo)&(base<hi)&~np.isnan(base)
        if m.sum()<50: print(f"  {lab:<12} {m.sum():>6} (표본 적음)"); continue
        wc=win[m].sum(); lc=lot[m].sum(); wa=(win[m]*base[m]).sum(); la=(lot[m]*base[m]).sum()
        print(f"  {lab:<12} {m.sum():>6,} {wc/lc:8.2f} {wa/la:8.2f} {wa/1e8:11.1f}억 {la/1e8:9.1f}억")
    m=te&covered&~np.isnan(base)
    print(f"  {'전체':<12} {m.sum():>6,} {win[m].sum()/lot[m].sum():8.2f} {(win[m]*base[m]).sum()/(lot[m]*base[m]).sum():8.2f}")
