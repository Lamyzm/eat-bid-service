"""모듈 책임: 아버지 두 사업자가 마감 몇 시간 전에 투찰하는지 분포와, 그 시점 참여 수가 마감 1시간 전 참여 수와 얼마나 다른지 낸다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
z=np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; biz=z['biz_no']; floor=z['floor']; ym=z['ym']
F=np.array(['3118152843','7175001228'])
rounds=np.repeat(np.arange(len(cnt)),cnt)
mine=np.isin(biz,F)
td=t[mine]; rd=rounds[mine]
print(f"아버지 투찰 {mine.sum():,}건 · 회차 {len(np.unique(rd)):,}")
qs=[0.1,0.25,0.5,0.75,0.9]
print("마감까지 남은 시간(시간) 분위수:", {q: round(float(np.quantile(td,q)),2) for q in qs})
for lo,hi in [(0,1),(1,3),(3,6),(6,24),(24,72),(72,1e9)]:
    m=(td>=lo)&(td<hi); print(f"  {lo:>4}~{hi if hi<1e9 else '∞':>4}h : {m.mean()*100:5.1f}%")
# 연도별 중앙값 — 습관이 바뀌었는지
for y in [2023,2024,2025,2026]:
    m=(ym[rd]//100==y)
    if m.sum(): print(f"  {y}: 중앙값 {np.median(td[m]):.1f}h ({m.sum():,}건)")
# 아버지가 넣는 순간의 참여 수(그 시점 이전에 들어온 투찰 수, 아버지 자신 제외) vs 마감 1시간 전 참여 수
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
nas1=np.bincount(rounds[t>=1.0],minlength=len(cnt))
rows=[]
for i in np.where(mine)[0]:
    r=rounds[i]; s,e=starts[r],starts[r]+cnt[r]
    n_then=int(((t[s:e]>t[i])).sum())        # 아버지보다 먼저(더 이른 시각에) 들어온 투찰
    rows.append((r,t[i],n_then,nas1[r],cnt[r],floor[r]))
a=np.array(rows,dtype=float)
f90=a[:,5]==90
print(f"\n하한율 90 회차의 아버지 투찰 {int(f90.sum()):,}건")
print("  그 순간 참여 수 중앙값", np.median(a[f90,2]), "· 마감 1h 전", np.median(a[f90,3]), "· 최종", np.median(a[f90,4]))
band=lambda n: np.where(n>=70,2,np.where(n>=40,1,0))
same=(band(a[f90,2])==band(a[f90,3])).mean()
print(f"  '그 순간 참여 수'와 '마감 1h 전 참여 수'로 고른 대역이 같은 비율 {same*100:.1f}%")
for lab,cond in [("그 순간 <40",a[f90,2]<40),("마감1h전 <40",a[f90,3]<40),("최종 <40",a[f90,4]<40)]:
    print(f"  {lab}: {cond.mean()*100:.1f}%")
np.save("dad_bids.npy",a)
