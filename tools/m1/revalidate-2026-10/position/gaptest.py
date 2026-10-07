"""모듈 책임: 투찰마다 점유 간격·회차 내 백분위·x-R을 계산해 다음 기간 비교용 특징으로 저장한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
from scipy.stats import spearmanr
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; wd=z['wd']; win=z['is_recorded_winner']; R=z['R']
nbid=z['nbid']; Rs=z['R_suspect']; ym=z['ym']; biz=z['biz_no']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
n=len(cnt)
gapv=np.full(len(x),np.nan,dtype=np.float32)
pctv=np.full(len(x),np.nan,dtype=np.float32)
dRv =np.full(len(x),np.nan,dtype=np.float32)
good=(~Rs)&(nbid>=10)
for r in np.where(good)[0]:
    s,e=starts[r],starts[r]+cnt[r]
    xs=x[s:e]; live=~wd[s:e]
    if live.sum()<3: continue
    idx=np.where(live)[0]
    v=xs[idx]; order=np.argsort(v,kind='stable'); sv=v[order]
    g=np.empty_like(sv); g[0]=np.nan; g[1:]=sv[1:]-sv[:-1]
    gg=np.empty_like(sv); gg[order]=g
    gapv[s+idx]=gg
    pctv[s+idx]=(np.argsort(np.argsort(v,kind='stable'),kind='stable')+0.5)/len(v)
    dRv[s+idx]=v-R[r]
np.savez_compressed("gapfeat.npz",gap=gapv,pct=pctv,dR=dRv)
print("특징 계산 완료. 유효:",int(np.isfinite(gapv).sum()))
