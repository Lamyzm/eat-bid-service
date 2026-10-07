"""모듈 책임: 회차별 15슬롯 실가격으로 만든 R 분위수 규칙을 아버지 회차에 채점하며, 투찰 전에 볼 수 없는 정보를 쓴 무효 판본으로 보존한다."""
import numpy as np, sys, io, itertools
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); p=np.load(b+"/plist.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; biz=z['biz_no']; Rs=z['R_suspect']
bid_id=z['bid_id']; nbid=z['nbid']; win=z['is_recorded_winner']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
F=['3118152843','7175001228']
fr=np.unique(rounds[np.isin(biz,F)&(~wd)]); fr=fr[~Rs[fr]]
# plist 조인
pid={v:i for i,v in enumerate(p['bid_id'])}
combos_idx=list(itertools.combinations(range(15),4))
QS=[0.02,0.05,0.10,0.15,0.20,0.30,0.40,0.50]
hit={q:0 for q in QS}; n=0; act=0
for r in fr.tolist():
    key=bid_id[r]
    if key not in pid: continue
    rates=p['rate'][pid[key]]
    Rd=np.sort(np.array([rates[list(c)].mean() for c in combos_idx]))
    s,e=starts[r],starts[r]+cnt[r]
    live=~wd[s:e]; xs=x[s:e]
    others=np.sort(xs[live & ~np.isin(biz[s:e],F)])
    Rr=float(R[r]); n+=1
    act+=int((np.isin(biz[s:e],F)&live&win[s:e]).any())
    for q in QS:
        xv=float(np.quantile(Rd,q))
        if xv>=Rr and not ((others>=Rr)&(others<xv)).any(): hit[q]+=1
print(f"아버지 회차 {n:,}   실제 낙찰 {act}건 ({act/n*100:.2f}%)")
print(f"\n{'규칙':>28} {'낙찰':>5} {'낙찰률':>8} {'실제대비':>8}")
for q in QS:
    print(f"  예정가격분포 하위 {q*100:4.0f}% 에 맞춤  {hit[q]:5d} {hit[q]/n*100:7.2f}% {hit[q]/max(act,1):7.2f}배")
