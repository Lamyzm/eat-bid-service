"""모듈 책임: 아버지 월별 참여·낙찰·x-R·실격률을 경쟁자와 나란히 로컬 자료 마지막 달까지 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; win=z['is_recorded_winner']; wd=z['wd']
ym=z['ym']; nbid=z['nbid']; biz=z['biz_no']; Rs=z['R_suspect']
rounds=np.repeat(np.arange(len(cnt)),cnt)
ymb=ym[rounds]; Rb=R[rounds]; okb=~Rs[rounds]
F=['3118152843','7175001228']
fm=np.isin(biz,F)&(~wd)&okb
print(f"{'연월':>7} {'참여회차':>7} {'투찰':>5} {'낙찰':>4} {'낙찰률':>7} {'아버지 x-R':>11} {'경쟁자 x-R':>11} {'실격률':>7} {'N중앙':>6}")
for m in sorted(set(ym[~Rs].tolist())):
    sel=fm&(ymb==m)
    if sel.sum()<5: continue
    rr=np.unique(rounds[sel]); nw=int((win&sel).sum())
    fdr=(x[sel]-Rb[sel])
    oth=(~np.isin(biz,F))&(~wd)&okb&(ymb==m)&np.isin(rounds,rr)
    odr=(x[oth]-Rb[oth])
    print(f"{m:>7} {len(rr):7d} {int(sel.sum()):5d} {nw:4d} {nw/len(rr)*100:6.2f}% "
          f"{np.median(fdr)*1e4:+10.1f} {np.median(odr)*1e4:+10.1f} "
          f"{(fdr<0).mean()*100:6.1f}% {int(np.median(nbid[rr])):6d}")
