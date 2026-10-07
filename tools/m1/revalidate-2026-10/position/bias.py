"""모듈 책임: 슬롯 번호별 득표 비중이 균등에서 얼마나 쏠렸는지 잰다."""
import numpy as np
b=r"F:/Project/eat-bid/data/mechanism"
v=np.load(b+"/votes2.npz",allow_pickle=True)
V=v['votes_all'].astype(np.int64); nb=v['nbid']
big=nb>=30
Vb=V[big]
tot=Vb.sum(axis=0); share=tot/tot.sum()
print(f"대상 회차 {big.sum():,}  총 투표 {tot.sum():,}")
print("\n슬롯번호별 득표 비중 (균등=6.667%)")
for i,s in enumerate(share):
    bar='#'*int(round(s*600))
    print(f"  {i+1:2d}번  {s*100:6.3f}%  {s/(1/15):5.3f}배  {bar}")
exp=tot.sum()/15
chi=((tot-exp)**2/exp).sum()
print(f"\n카이제곱 = {chi:,.0f}  (자유도 14, 균등이면 ~14)")
print(f"최대/최소 = {share.max()/share.min():.3f}배")
