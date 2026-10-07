"""모듈 책임: R이 승자 투찰에서 역산되지 않았는지, f_R 시뮬레이션이 실제 R과 맞는지 검정한다."""
import numpy as np, sys, io
from scipy import stats
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; irw=z['is_recorded_winner']
ym=z['ym']; nbid=z['nbid']; floor=z['floor']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]]); rounds=np.repeat(np.arange(len(cnt)),cnt)
te=np.where((ym>=202601)&(~Rs)&(floor==90.0)&(nbid>=40)&(nbid<=70))[0]
# ---- R 이 개찰 결과(승자 투찰)에서 역산된 것인가
dmin=[];nwin=[];rule_ok=0;norec=0
for r in te.tolist():
    s,e=starts[r],starts[r]+cnt[r]; live=~wd[s:e]; o=x[s:e][live]; Rr=float(R[r])
    ab=o[o>=Rr]
    dmin.append(ab.min()-Rr if len(ab) else np.nan)
    wi=irw[s:e][live]; nwin.append(int(wi.sum()))
    if wi.sum()==1 and len(ab) and abs(o[wi][0]-ab.min())<1e-9: rule_ok+=1
    if wi.sum()==0: norec+=1
dmin=np.array(dmin); nwin=np.array(nwin)
print("[K] R 의 독립성 검사 (3438 회차)")
print("  min{x>=R} - R : 중위 %.6f  평균 %.6f  ==0 인 회차 %d  <1e-6 인 회차 %d"%(
    np.nanmedian(dmin),np.nanmean(dmin),int((dmin==0).sum()),int((np.abs(dmin)<1e-6).sum())))
print("  기록 승자 수 분포:",dict(zip(*np.unique(nwin,return_counts=True))))
print("  규칙이 기록 승자를 재현: %d/%d = %.3f%%"%(rule_ok,len(te),100*rule_ok/len(te)))
# ---- f_R 검증: 시뮬 R 분포 vs 실제 R
rng=np.random.default_rng(0); al=0.03; ns=400000
lo=rng.uniform(1-al,1.0,(ns,8)); hi=rng.uniform(1.0,1+al,(ns,7))
v=np.concatenate([lo,hi],axis=1); idx=np.argsort(rng.random((ns,15)),axis=1)[:,:4]
Rsim=np.take_along_axis(v,idx,axis=1).mean(1)
Rem=R[(floor==90.0)&(~Rs)&(ym<=202512)]
Rem26=R[(floor==90.0)&(~Rs)&(ym>=202601)]
print("\n[L] f_R 타당성")
for nm,arr in [("시뮬 α=0.03",Rsim),("실제 ≤2025-12",Rem),("실제 2026",Rem26)]:
    print(f"  {nm:14s} n={len(arr):>7,} 평균 {arr.mean():.6f} 표준편차 {arr.std():.6f} "
          f"p05 {np.percentile(arr,5):.5f} p50 {np.percentile(arr,50):.5f} p95 {np.percentile(arr,95):.5f}")
print("  KS(시뮬, 실제≤2025): D=%.4f"%stats.ks_2samp(Rsim[:50000],Rem[:50000]).statistic)
print("  P(R<=0.988): 시뮬 %.4f 실제2026 %.4f"%((Rsim<=0.988).mean(),(Rem26<=0.988).mean()))
# ---- 월별 분해
NB=lambda n: int(np.clip((n-40)//5,0,5)); tbl={0:0.9890,1:0.9880,2:0.9875,3:0.9880,4:0.9875,5:0.9880}
print("\n[M] 월별 분해 (버킷 x)")
for m in np.unique(ym[te]):
    rs=te[ym[te]==m]; hit=0; e=0.0
    for r in rs.tolist():
        s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=x[s:en][live]; N=len(o); Rr=float(R[r]); e+=1/max(N,1)
        xv=tbl[NB(int(nbid[r]))]
        if xv>=Rr and not ((o>=Rr)&(o<xv)).any(): hit+=1
    print(f"  {m} 회차{len(rs):5d} 적중{hit:4d} 기대{e:7.2f} {hit/e if e>0 else 0:6.3f}배")
# ---- 공정성: 기존 입찰자 한 명을 우리로 대체 (경쟁자 N-1)
print("\n[N] 공정 비교: 기존 1명 대체(경쟁자 N-1) 버전")
hit=0;e=0.0
for r in te.tolist():
    s,en=starts[r],starts[r]+cnt[r]; live=~wd[s:en]; o=np.sort(x[s:en][live]); N=len(o); Rr=float(R[r]); e+=1/max(N,1)
    xv=tbl[NB(int(nbid[r]))]
    if xv<Rr: continue
    blk=o[(o>=Rr)&(o<xv)]
    # 차단자가 0명이면 항상 승 / 1명이면 그 사람을 제거할 확률 1/N
    k=len(blk)
    if k==0: hit+=1
    elif k==1: hit+=1.0/N
print(f"  기대적중 {hit:.2f} 기대 {e:.2f} -> {hit/e:.3f}배")
