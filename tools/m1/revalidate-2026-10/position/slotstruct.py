"""모듈 책임: 슬롯 번호별 예비가격 요율 분포가 같은지 확인해 1·8·15번 고정 구간 주장을 eaT 자료로 검정한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
p=np.load(b+"/plist.npz",allow_pickle=True)
r=p['rate']; ok=np.isfinite(r).all(axis=1)&(p['bgng']>0)
r=r[ok]; print("회차",len(r))
print("\n슬롯번호별 요율 (무작위 배정이면 전부 같아야):")
print(f"{'슬롯':>4} {'평균':>9} {'최소':>8} {'최대':>8} {'=1.0000 비율':>12}")
for i in range(15):
    c=r[:,i]
    print(f"{i+1:4d} {c.mean():9.5f} {c.min():8.4f} {c.max():8.4f} {np.mean(np.abs(c-1.0)<1e-6)*100:11.2f}%")
print("\n회차별 최소/최대 요율:")
print(f"  최소 평균 {r.min(axis=1).mean():.5f}   최대 평균 {r.max(axis=1).mean():.5f}")
print(f"  1.0 미만 개수 분포:",np.bincount((r<1.0).sum(axis=1),minlength=16)[6:11].tolist(),"(6~10개)")
print(f"  정확히 1.0000인 슬롯이 있는 회차: {np.mean((np.abs(r-1.0)<1e-6).any(axis=1))*100:.2f}%")
