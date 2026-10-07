"""모듈 책임: 투찰 시각 t의 분포와 철회·유효 투찰의 시각 차이를 확인한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); a=np.load(b+"/asof.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; wd=z['wd']
rounds=np.repeat(np.arange(len(cnt)),cnt)
print("xcap2 t: min %.3f max %.3f"%(t.min(),t.max()), np.percentile(t,[1,25,50,75,99]))
print("withdrawn t 중위 %.3f, live t 중위 %.3f"%(np.median(t[wd]),np.median(t[~wd])))
# asof x가 xcap2 live x의 부분집합인가
bz=z['bid_id']; ba=a['bid_id']
common,iz,ia=np.intersect1d(bz,ba,return_indices=True)
cz=cnt; sz=np.concatenate([[0],np.cumsum(cz)[:-1]])
ca=a['off']; sa=np.concatenate([[0],np.cumsum(ca)[:-1]])
xz=z['x']; xa=a['x']; ta=a['t']
# 샘플 회차 몇개 비교
rng=np.random.default_rng(1)
pick=rng.choice(len(common),6,replace=False)
for p in pick:
    r=iz[p]; q=ia[p]
    lv=~wd[sz[r]:sz[r]+cz[r]]
    A=np.sort(xz[sz[r]:sz[r]+cz[r]][lv]); B=np.sort(xa[sa[q]:sa[q]+ca[q]])
    print(f"bid {common[p]}: xcap2 live {len(A)} asof {len(B)} 동일={len(A)==len(B) and np.allclose(A,B,atol=1e-6)}")
# t 비교: asof t가 xcap2 t와 같은가
print("\nasof t: min %.3f max %.3f"%(ta.min(),ta.max()), np.percentile(ta,[1,50,99]))
# R 차이 큰 회차
dR=np.abs(a['R'][ia]-z['R'][iz])
print("\nR 차이>1e-6 회차:",int((dR>1e-6).sum()),"  >0.01:",int((dR>0.01).sum()))
