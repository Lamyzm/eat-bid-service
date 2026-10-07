"""모듈 책임: 두 장 규칙 0.9855·0.9920을 아버지가 실제 참여한 회차에 넣어 연도별 실제 낙찰과 비교한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; ym=z['ym']
floor=z['floor']; biz=z['biz_no']; win=z['is_recorded_winner']; t=z['t']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
NAS=np.bincount(rounds[t>=1.0],minlength=len(cnt))
F=['3118152843','7175001228']
fr=np.unique(rounds[np.isin(biz,F)])
PAIR=(0.9855,0.9920)
for lab,yr in [("2026년(검증)",2026),("2025년",2025),("2024년",2024)]:
    sel=[r for r in fr.tolist() if ym[r]//100==yr and not Rs[r] and floor[r]==90.0 and 40<=NAS[r]<=69]
    if len(sel)<30: 
        print(f"{lab}: 회차 {len(sel)} — 표본 부족"); continue
    hit=0; act=0
    for r in sel:
        s,e=starts[r],starts[r]+cnt[r]
        mine=np.isin(biz[s:e],F)
        o=np.sort(x[s:e][~mine])          # 내 두 장을 뺀 경쟁자
        Rr=float(R[r])
        oo=o[o>=Rr]
        w=any(xv>=Rr and np.searchsorted(oo,xv,side='left')==0 for xv in PAIR)
        hit+=w; act+=int((mine&win[s:e]).any())
    print(f"{lab}: {len(sel):3d}회차   규칙 {hit:3d}건({hit/len(sel)*100:5.2f}%)   아버지 실제 {act:3d}건({act/len(sel)*100:5.2f}%)   {hit/max(act,1):.2f}배")
