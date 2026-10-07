"""모듈 책임: 로컬 자료의 회차 5744105 투찰 명단을 꺼내 운영 DB와 행 단위로 대조할 기준값을 만든다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; biz=z['biz_no']; win=z['is_recorded_winner']; rnk=z['rnk']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
r=int(np.where(z['bid_id']=='5744105')[0][0])
s,e=starts[r],starts[r]+cnt[r]
BASE=17159500; Rr=float(R[r])
xs=x[s:e]; o=np.argsort(xs)
print(f"npz 회차 5744105  투찰 {cnt[r]}건  R={Rr:.5f}  철회 {int(wd[s:e].sum())}")
print(f"R 미만 {int((xs<Rr).sum())}건 / R 이상 {int((xs>=Rr).sum())}건")
print(f"\n{'x':>9} {'금액(x×기초×0.9)':>16} {'rnk':>4} {'철회':>4} {'낙찰':>4} biz")
for k in list(o[:6])+list(o[-3:]):
    print(f"{xs[k]:9.5f} {xs[k]*BASE*0.9:16,.0f} {rnk[s+k]:4d} {int(wd[s+k]):4d} {int(win[s+k]):4d} {biz[s+k]}")
