"""모듈 책임: 15슬롯 실가격 분위수 두 장 규칙의 2026년 시장 검정이며, 미래 정보가 샌 무효 판본으로 보존한다."""
import numpy as np, sys, io, itertools
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); p=np.load(b+"/plist.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; bid_id=z['bid_id']
ym=z['ym']; nbid=z['nbid']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
pid={v:i for i,v in enumerate(p['bid_id'])}
CI=np.array(list(itertools.combinations(range(15),4)))
QA,QB=0.12,0.56
sel=np.where((ym>=202601)&(~Rs)&(nbid>=40)&(nbid<=70))[0]
w=0; n=0; exp=0.0; var=0.0
for r in sel.tolist():
    k=bid_id[r]
    if k not in pid: continue
    Rd=np.sort(p['rate'][pid[k]][CI].mean(axis=1))
    s,e=starts[r],starts[r]+cnt[r]
    live=~wd[s:e]; oth=np.sort(x[s:e][live]); Rr=float(R[r]); N=int(live.sum())
    if N<2: continue
    n+=1
    hit=any(xv>=Rr and not ((oth>=Rr)&(oth<xv)).any() for xv in np.quantile(Rd,[QA,QB]))
    w+=hit
    q=min(2.0/N,1.0); exp+=q; var+=q*(1-q)
print(f"2026년 N 40-70 회차 {n:,}  (규칙 파라미터는 2025년까지로 선택)")
print(f"  규칙 2장 낙찰 {w}건  = {w/n*100:.2f}%")
print(f"  제비뽑기 2장 기대 {exp:.1f}건 = {exp/n*100:.2f}%")
print(f"  배수 {w/exp:.3f}   z = {(w-exp)/var**0.5:+.2f}")
