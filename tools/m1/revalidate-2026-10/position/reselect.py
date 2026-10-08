"""모듈 책임: 검증 기간을 보지 않는 사전 고정 절차(순차 선택 + 학습 곡선 평활, 평활 폭은 2024→2025 안쪽 검증으로 결정)로 대역별 1~3장 투찰률을 다시 고르고 2026-01~08로 한 번만 채점한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
d=np.load("winmat.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
keep=(G>=0.980-1e-9)&(G<=1.004+1e-9); Gk=G[keep]; Mk=M[:,keep]
BANDS=[("10~19",10,19),("20~29",20,29),("30~39",30,39),("40~69",40,69),("70+",70,10**6)]
WIDTHS=[0,1,2,3,4,6]
def smooth(v,w):
    if w==0: return v
    k=np.ones(2*w+1); return np.convolve(v,k,'same')/np.convolve(np.ones_like(v),k,'same')
def pick(mask,w,k=3):
    """순차 선택: 앞 장을 고정하고 다음 장의 합집합 낙찰 곡선을 평활해 꼭대기를 고른다."""
    X=Mk[mask]; won=np.zeros(len(X),bool); chosen=[]
    for _ in range(k):
        curve=(won[:,None]|X).mean(axis=0)
        s=smooth(curve,w); s[chosen]=-1
        j=int(np.argmax(s)); chosen.append(j); won|=X[:,j]
    return chosen
def evaluate(mask,chosen):
    X=Mk[mask]; won=np.zeros(len(X),bool); out=[]
    for k,j in enumerate(chosen,1):
        won|=X[:,j]; lot=np.minimum(k/np.maximum(NT[mask],1),1)
        out.append((int(won.sum()),won.mean(),lot.mean()))
    return out
inner_tr=YM<=202412; inner_va=(YM>=202501)&(YM<=202512)
tr=YM<=202512; te=(YM>=202601)&(YM<=202608)
band_mask=lambda lo,hi:(NA>=lo)&(NA<=hi)
# 1) 안쪽 검증으로 평활 폭 하나를 정한다(모든 대역·1~3장 합산 배수)
print("안쪽 검증(≤2024 선택 → 2025 채점), 대역·장수 합산")
best=None
for w in WIDTHS:
    W=L=0.0
    for _,lo,hi in BANDS:
        b=band_mask(lo,hi); ch=pick(inner_tr&b,w)
        for wins,rate,lot in evaluate(inner_va&b,ch):
            n=(inner_va&b).sum(); W+=rate*n; L+=lot*n
    print(f"  w={w}: 배수 {W/L:.4f}")
    if best is None or W/L>best[1]: best=(w,W/L)
w=best[0]; print(f"→ 평활 폭 w={w} 고정 (격자 {0.0005*(2*w+1):.4f} 폭)\n")
# 2) ≤2025로 최종 선택, 2026-01~08로 한 번 채점
print(f"{'대역':<6} {'검증회차':>7}  자리  {'값':>6} {'누적낙찰':>6} {'낙찰률':>9} {'운':>9} {'배수':>5}")
CUR={"40~69":[0.9855,0.9920,0.9945],"70+":[0.9830,0.9900,0.9880]}
for name,lo,hi in BANDS:
    b=band_mask(lo,hi); ch=pick(tr&b,w); n=int((te&b).sum())
    for k,(j,(wins,rate,lot)) in enumerate(zip(ch,evaluate(te&b,ch)),1):
        print(f"{name:<6} {n:>7,}  {k}번  {Gk[j]:.4f} {wins:>6} {rate*100:8.4f}% {lot*100:8.4f}% {rate/lot:5.2f}")
    if name in CUR:
        cj=[int(np.argmin(np.abs(Gk-v))) for v in CUR[name]]
        r=evaluate(te&b,cj)
        print(f"{'':<6} {'':>7}  (현행 {'/'.join(f'{v:.4f}' for v in CUR[name])}: " + " · ".join(f"{x[1]/x[2]:.2f}" for x in r) + ")")
