"""모듈 책임: 아버지 패배를 전부 실격과 경쟁자에게 밟힘으로 나누고 각각의 거리를 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; win=z['is_recorded_winner']; wd=z['wd']
ym=z['ym']; nbid=z['nbid']; biz=z['biz_no']; Rs=z['R_suspect']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
F=['3118152843','7175001228']
fb=np.isin(biz,F)&(~wd)
fr=np.unique(rounds[fb]); fr=fr[~Rs[fr]]
rec={}
for r in fr.tolist():
    s,e=starts[r],starts[r]+cnt[r]
    xs=x[s:e]; live=~wd[s:e]; mine=np.isin(biz[s:e],F)&live
    if not mine.any(): continue
    Rr=float(R[r]); fx=xs[mine]
    w=win[s:e]&live
    wx=float(xs[w][0]) if w.any() else None
    won=bool((mine&w).any())
    above=fx[fx>=Rr]
    m=int(ym[r])
    d=rec.setdefault(m,{'n':0,'won':0,'allout':0,'stomped':0,'gap':[],'short':[]})
    d['n']+=1
    if won: d['won']+=1
    elif len(above)==0:
        d['allout']+=1
        d['short'].append(Rr-fx.max())          # R 까지 모자란 폭
    else:
        d['stomped']+=1
        if wx is not None: d['gap'].append(above.min()-wx)   # 낙찰가보다 얼마나 위였나
print(f"{'연월':>7} {'회차':>5} {'낙찰':>4} {'전부실격':>8} {'밟힘':>6} {'실격시 R까지':>12} {'밟힘시 낙찰가 위':>15}")
for m in sorted(rec):
    d=rec[m]
    if d['n']<20: continue
    sh=np.median(d['short'])*1e4 if d['short'] else float('nan')
    gp=np.median(d['gap'])*1e4 if d['gap'] else float('nan')
    print(f"{m:>7} {d['n']:5d} {d['won']:4d} {d['allout']:5d}({d['allout']/d['n']*100:4.0f}%) "
          f"{d['stomped']:5d} {sh:11.1f}bp {gp:14.1f}bp")
