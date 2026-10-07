"""모듈 책임: R이 득표 상위 4 평균이라는 규칙과 아래 8·위 7 생성 규칙을 소수 4자리 요율로 재현한다."""
import numpy as np
b=r"F:/Project/eat-bid/data/mechanism"
v=np.load(b+"/votes2.npz",allow_pickle=True); p=np.load(b+"/plist.npz",allow_pickle=True)
z=np.load(b+"/xcap2.npz",allow_pickle=True)

# --- 검증 1: R = mean(득표 상위4, 동점은 낮은 번호 우선)
ids,iv,ip=np.intersect1d(v['bid_id'],p['bid_id'],return_indices=True)
V=v['votes_all'][iv]; rates=p['rate'][ip]; bgng=p['bgng'][ip]; plnprc=p['plnprc'][ip]
ok=bgng>0
top4=np.argsort(-V,axis=1,kind='stable')[:,:4]          # stable = 동점시 낮은 index 우선
R_calc=np.take_along_axis(rates,top4,axis=1).mean(axis=1)
R_true=np.where(ok,plnprc/np.where(ok,bgng,1),np.nan)
d=np.abs(R_calc-R_true)[ok]
print(f"[검증1] n={ok.sum():,}")
for tol,lab in [(1e-6,"1e-6"),(1e-5,"1e-5"),(1e-4,"1e-4")]:
    print(f"   |R_계산 - R_실제| < {lab} : {(d<tol).mean()*100:6.2f}%")
print(f"   문서 주장 99.96%")

# --- 검증 2: 아래 8 / 위 7
below=(rates<1.0).sum(axis=1)
print(f"\n[검증2] rates<1.0 개수 분포:",np.bincount(below,minlength=16)[:16].tolist())
print(f"   정확히 8개인 비율: {(below==8).mean()*100:.2f}%")
