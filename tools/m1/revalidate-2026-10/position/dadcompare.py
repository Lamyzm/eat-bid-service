"""모듈 책임: 아버지가 2026-01~08에 실제로 넣은 하한율 90 회차에서, 아버지 투찰을 같은 장수의 규칙 값(새·현행)으로 바꿨을 때의 낙찰을 아버지 실제·제비뽑기 기대와 비교한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; Rs=z['R_suspect']; ym=z['ym']; floor=z['floor']
biz=z['biz_no']; win=z['is_recorded_winner']; t=z['t']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
NAS=np.bincount(rounds[t>=1.0],minlength=len(cnt))
F=['3118152843','7175001228']
NEW={(10,19):[0.9925,1.0000,0.9960],(20,29):[0.9925,0.9885,0.9970],(30,39):[0.9885,0.9935,0.9985],
     (40,69):[0.9860,0.9920,0.9955],(70,10**6):[0.9835,0.9890,0.9910]}
CUR={(40,69):[0.9855,0.9920,0.9945],(70,10**6):[0.9830,0.9900,0.9880]}
def vals(table,n):
    for (lo,hi),v in table.items():
        if lo<=n<=hi: return v
    return None
fr=np.unique(rounds[np.isin(biz,F)])
rows={}
for r in fr.tolist():
    if Rs[r] or floor[r]!=90.0 or not (202601<=ym[r]<=202608): continue
    s,e=starts[r],starts[r]+cnt[r]; mine=np.isin(biz[s:e],F); k=int(min(mine.sum(),3))
    o=np.sort(x[s:e][~mine]); Rr=float(R[r]); oo=o[o>=Rr]
    beats=lambda xv: xv>=Rr and np.searchsorted(oo,xv,side='left')==0
    n=int(NAS[r]); key='40~69' if 40<=n<=69 else ('70+' if n>=70 else ('10~39' if n>=10 else '<10'))
    nv=vals(NEW,n); cv=vals(CUR,n)
    rec=rows.setdefault(key,[0,0,0.0,0,0,0])
    rec[0]+=1
    rec[1]+=int((mine&win[s:e]).any())
    rec[2]+=min(k/max(cnt[r],1),1)
    rec[3]+=int(nv is not None and any(beats(v) for v in nv[:k]))
    rec[4]+=int(cv is not None and any(beats(v) for v in cv[:k]))
    rec[5]+=int(cv is not None)
print(f"{'대역(1h전)':<10} {'회차':>5} {'아버지실제':>8} {'운 기대':>7} {'새 규칙':>7} {'현행':>6}")
tot=np.zeros(6)
for key in ['10~39','40~69','70+','<10']:
    if key not in rows: continue
    a=rows[key]; tot+=np.array(a,dtype=float)
    print(f"{key:<10} {a[0]:>5} {a[1]:>8} {a[2]:>7.1f} {a[3]:>7} {a[4] if a[5] else '—':>6}")
print(f"{'합계':<10} {int(tot[0]):>5} {int(tot[1]):>8} {tot[2]:>7.1f} {int(tot[3]):>7}")
print(f"\n새 규칙 / 아버지 실제 = {tot[3]/max(tot[1],1):.2f}배 · 새 규칙 / 운 = {tot[3]/tot[2]:.2f}배 · 아버지 실제 / 운 = {tot[1]/tot[2]:.2f}배")
