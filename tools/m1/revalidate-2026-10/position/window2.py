"""모듈 책임: 낙찰자가 점유한 간격과 R 바로 위 20bp 안의 밀집 인원을 잰다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; wd=z['wd']; win=z['is_recorded_winner']; R=z['R']; nbid=z['nbid']; Rs=z['R_suspect']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
sel=np.where((nbid>=30)&(~Rs))[0]
gap=[]; nabove=[]; crowd=[]
for r in sel.tolist():
    s,e=starts[r],starts[r]+cnt[r]
    xs=x[s:e]; live=~wd[s:e]; w=win[s:e]
    if not (w&live).any(): continue
    wx=float(xs[w&live][0]); Rr=float(R[r])
    o=np.sort(xs[live]); prev=o[o<wx]
    gap.append(wx-(prev[-1] if len(prev) else Rr))
    nabove.append(int(((xs>=Rr)&live).sum()))
    # R 부근 20bp 안에 몇 명이 몰려 있나
    crowd.append(int((live&(xs>=Rr)&(xs<Rr+0.0020)).sum()))
gap=np.array(gap)*1e4; nabove=np.array(nabove); crowd=np.array(crowd)
print("낙찰자가 점유한 간격 (낙찰가 minus 바로 아래 투찰가, bp):")
for q in [10,25,50,75,90]: print(f"   {q}%분위 {np.percentile(gap,q):7.2f}")
print(f"   평균 {gap.mean():.2f}")
print(f"\nR 이상 투찰자 수 중앙: {int(np.median(nabove))}   (N 중앙 {int(np.median(nbid[sel]))})")
print(f"R 바로 위 20bp 안에 몰린 인원 중앙: {int(np.median(crowd))}  평균 {crowd.mean():.1f}")
