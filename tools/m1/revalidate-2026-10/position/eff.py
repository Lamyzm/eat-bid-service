"""모듈 책임: 하한 미달 투찰을 뺀 위험집합으로 아버지 배수를 다시 내 실격이 시장 공통 현상인지 확인한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; win=z['is_recorded_winner']; wd=z['wd']
ym=z['ym']; biz=z['biz_no']; Rs=z['R_suspect']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
F=['3118152843','7175001228']
fr=np.unique(rounds[np.isin(biz,F)&(~wd)]); fr=fr[~Rs[fr]]
def blk(lab,rs):
    e_all=e_eff=0.0; v_all=v_eff=0.0; act=0; n=0; dead=0; tick=0
    for r in rs:
        s,ee=starts[r],starts[r]+cnt[r]
        live=~wd[s:ee]; mine=np.isin(biz[s:ee],F)&live
        if not mine.any(): continue
        Rr=float(R[r]); xs=x[s:ee]
        k=int(mine.sum()); N=int(live.sum())
        ka=int((mine&(xs>=Rr)).sum()); Na=int((live&(xs>=Rr)).sum())
        tick+=k; dead+=k-ka
        if N: p=k/N; e_all+=p; v_all+=p*(1-p)
        if Na: q=ka/Na; e_eff+=q; v_eff+=q*(1-q)
        act+=int((mine&win[s:ee]).any()); n+=1
    z1=(act-e_all)/v_all**0.5; z2=(act-e_eff)/v_eff**0.5
    print(f"{lab:10s} 회차{n:5d}  죽은표 {dead/tick*100:4.1f}%")
    print(f"             전체표 기준  기대 {e_all:6.2f}  배수 {act/e_all:.3f}  z={z1:+5.2f}")
    print(f"             R이상만 기준 기대 {e_eff:6.2f}  배수 {act/e_eff:.3f}  z={z2:+5.2f}")
blk("전체",fr.tolist())
for y in (2024,2025,2026):
    sub=[r for r in fr.tolist() if ym[r]//100==y]
    if sub: blk(f"{y}년",sub)
