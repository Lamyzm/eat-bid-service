"""모듈 책임: 아버지 낙찰을 1/N 두 장 제비뽑기 기대와 비교하며, 이후 메커니즘 귀무로 대체된 판정의 재현본이다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; win=z['is_recorded_winner']; wd=z['wd']
ym=z['ym']; nbid=z['nbid']; biz=z['biz_no']; Rs=z['R_suspect']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
rounds=np.repeat(np.arange(len(cnt)),cnt)
F=['3118152843','7175001228']
fb=np.isin(biz,F)&(~wd)
fr=np.unique(rounds[fb]); fr=fr[~Rs[fr]]
def block(name,mask_rounds):
    exp=0.0; act=0; var=0.0; n=0
    for r in mask_rounds:
        s,e=starts[r],starts[r]+cnt[r]
        live=~wd[s:e]; mine=np.isin(biz[s:e],F)&live
        k=int(mine.sum()); Nl=int(live.sum())
        if k==0 or Nl==0: continue
        p=k/Nl; exp+=p; var+=p*(1-p); n+=1
        act+=int((mine&win[s:e]).any())
    sd=var**0.5
    z_=(act-exp)/sd if sd>0 else 0
    print(f"{name:14s} 회차 {n:5d}  기대 {exp:7.2f}  실제 {act:4d}  차 {act-exp:+7.2f}  z={z_:+5.2f}  배수 {act/exp:.3f}")
block("전체(33개월)", fr.tolist())
for y,lab in [(2024,"2024년"),(2025,"2025년"),(2026,"2026년")]:
    sub=[r for r in fr.tolist() if ym[r]//100==y]
    if sub: block(lab,sub)
print("\n(z가 +2 넘으면 '제비뽑기보다 낫다'고 말할 수 있음)")
