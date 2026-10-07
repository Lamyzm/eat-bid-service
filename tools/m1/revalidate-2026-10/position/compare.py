"""모듈 책임: 지속 상위·중간·아버지 집단의 투찰 위치·실격률·참여 N·투찰 시각을 비교한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True); f=np.load("gapfeat.npz")
cnt=z['off']; wd=z['wd']; biz=z['biz_no']; Rs=z['R_suspect']; x=z['x']; R=z['R']
t=z['t']; nbid=z['nbid']
rounds=np.repeat(np.arange(len(cnt)),cnt)
ok=(~wd)&(~Rs[rounds])
dR=(x-R[rounds])
pct=f['pct']
print("t 범위:",float(np.nanmin(t[ok])),"~",float(np.nanmax(t[ok])),"  중앙",float(np.nanmedian(t[ok])))
E=set(np.load("elite.npy",allow_pickle=True).tolist())
M=set(np.load("mid.npy",allow_pickle=True).tolist())
F={'3118152843','7175001228'}
def prof(name,s):
    m=ok&np.isin(biz,list(s))
    d=dR[m]; pc=pct[m]; tt=t[m]; nn=nbid[rounds][m]
    fin=np.isfinite(pc)
    print(f"{name:12s} n={int(m.sum()):7d} "
          f"| x-R 중앙 {np.median(d)*1e4:+7.1f}bp  산포(IQR) {(np.percentile(d,75)-np.percentile(d,25))*1e4:6.1f}bp "
          f"| 실격률 {(d<0).mean()*100:5.1f}% "
          f"| 회차내백분위 {np.mean(pc[fin]):.3f} "
          f"| N중앙 {int(np.median(nn)):3d} "
          f"| t중앙 {np.nanmedian(tt):.3f}")
prof("고수 84",E); prof("중간 287",M); prof("아버지",F)
