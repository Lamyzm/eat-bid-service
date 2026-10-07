"""모듈 책임: 득표 인기 상위 4 슬롯 가정으로 R을 예측해 균등 가정 대비 오차와 승부 창문을 비교한다."""
import numpy as np, itertools
b=r"F:/Project/eat-bid/data/mechanism"
v=np.load(b+"/votes2.npz",allow_pickle=True); p=np.load(b+"/plist.npz",allow_pickle=True)
ids,iv,ip=np.intersect1d(v['bid_id'],p['bid_id'],return_indices=True)
V=v['votes_all'][iv]; nb=v['nbid'][iv]; rates=p['rate'][ip]
R_act=np.array([r[np.argsort(-vv,kind='stable')[:4]].mean() for vv,r in zip(V,rates)])
big=nb>=30
V,nb,rates,R_act=V[big],nb[big],rates[big],R_act[big]
print(f"대상 회차 {len(nb):,} (N>=30)")
# 사전 인기순위 (전체에서 추정)
share=V.sum(axis=0)/V.sum(); order=np.argsort(-share)
print("인기 상위4 슬롯번호:",(order[:4]+1).tolist(),"비중",np.round(share[order[:4]]*100,2).tolist())
top4=np.argsort(-V,axis=1,kind='stable')[:,:4]
hit=np.array([len(set(t.tolist())&set(order[:4].tolist())) for t in top4])
print("실제 top4가 인기 top4와 겹치는 개수 분포:",np.bincount(hit,minlength=5).tolist())
# 예측 셋
R_prior=rates[:,order[:4]].mean(axis=1)             # 인기 상위4 가정
R_unif=rates.mean(axis=1)                            # 균등가정(=15개 평균)
for name,pred in [("인기 top4 가정",R_prior),("균등(15개 평균)",R_unif)]:
    err=np.abs(pred-R_act)
    print(f"  {name:16s} MAE {err.mean()*1e4:7.2f} bp   상관 {np.corrcoef(pred,R_act)[0,1]:+.4f}")
print(f"\n승부 창문(문서) 5.8 bp 와 비교할 것")
