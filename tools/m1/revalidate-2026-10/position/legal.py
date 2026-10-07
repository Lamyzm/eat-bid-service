"""모듈 책임: 투찰 전 정보만 쓰는 고정 투찰률 두 개를 학습기로 고르고 2026년 하한율 90·N 40~70에서 채점한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; x=z['x']; R=z['R']; wd=z['wd']; Rs=z['R_suspect']; ym=z['ym']; nbid=z['nbid']
starts=np.concatenate([[0],np.cumsum(cnt)[:-1]])
G=np.arange(0.975,1.0151,0.0005)
def mat(sel):
    M=np.zeros((len(sel),len(G)),dtype=bool); E=np.zeros(len(sel))
    for i,r in enumerate(sel):
        s,e=starts[r],starts[r]+cnt[r]
        live=~wd[s:e]; o=x[s:e][live]; Rr=float(R[r]); N=int(live.sum())
        oo=np.sort(o[o>=Rr])
        c=np.searchsorted(oo,G,side='left')
        M[i]=(G>=Rr)&(c==0); E[i]=min(2.0/max(N,1),1.0)
    return M,E
tr=np.where((ym<=202512)&(~Rs)&(nbid>=40)&(nbid<=70))[0]
te=np.where((ym>=202601)&(~Rs)&(nbid>=40)&(nbid<=70))[0]
Mtr,_=mat(tr.tolist()); Mte,Ete=mat(te.tolist())
print(f"학습 {len(tr):,}회차  채점 {len(te):,}회차")
best=(-1,0,0)
for i in range(len(G)):
    oi=Mtr[:,i]
    for j in range(i,len(G)):
        w=int((oi|Mtr[:,j]).sum())
        if w>best[0]: best=(w,i,j)
w,i,j=best
print(f"\n학습기 최적 두 비율: {G[i]:.4f} + {G[j]:.4f}   →  {w}건 ({w/len(tr)*100:.2f}%)")
hit=int((Mte[:,i]|Mte[:,j]).sum()); exp=Ete.sum()
var=(Ete*(1-Ete)).sum()
print(f"\n2026 채점 (봉인)")
print(f"   규칙 두 비율   {hit}건 = {hit/len(te)*100:.2f}%")
print(f"   제비뽑기 2장   {exp:.1f}건 = {exp/len(te)*100:.2f}%")
print(f"   배수 {hit/exp:.3f}   z = {(hit-exp)/var**0.5:+.2f}")
