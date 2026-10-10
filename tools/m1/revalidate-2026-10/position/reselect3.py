"""모듈 책임: 하한율별로 §12의 사전 고정 절차를 운 기준선 k/(N+k)로 바로잡아 다시 적용(평활 폭은 ≤2024→2025 안쪽 검증)하고 여섯 대역의 1~3장 값과 2026-01~08 채점·제품 표 수치를 낸다."""
import numpy as np, sys, io, json
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
floor=sys.argv[1]; fixed_w=None if sys.argv[2]=="auto" else int(sys.argv[2])
d=np.load(f"winmat{floor}.npz"); M,NT,YM,NA,G=d['M'],d['NT'],d['YM'],d['NA'],d['G']
keep=(G>=0.980-1e-9)&(G<=1.004+1e-9); Gk=G[keep]; Mk=M[:,keep]
BANDS=[(2,9),(10,19),(20,29),(30,39),(40,69),(70,None)]
def bm(lo,hi): return (NA>=lo)&(NA<=(hi if hi is not None else 10**6))
def smooth(v,w):
    if w==0: return v
    k=np.ones(2*w+1); return np.convolve(v,k,'same')/np.convolve(np.ones_like(v),k,'same')
def pick(mask,w,k=3):
    X=Mk[mask]; won=np.zeros(len(X),bool); ch=[]
    for _ in range(k):
        s=smooth((won[:,None]|X).mean(axis=0),w); s[ch]=-1; j=int(np.argmax(s)); ch.append(j); won|=X[:,j]
    return ch
# 규칙 표는 기존 투찰에 더해지므로 공정한 운은 k/(N+k)이다.
def evaluate(mask,ch):
    X=Mk[mask]; won=np.zeros(len(X),bool); out=[]
    for k,j in enumerate(ch,1):
        won|=X[:,j]; lot=k/(NT[mask]+k); out.append((int(won.sum()),won.mean(),lot.mean()))
    return out
inner_tr=YM<=202412; inner_va=(YM>=202501)&(YM<=202512); tr=YM<=202512; te=(YM>=202601)&(YM<=202608)
if fixed_w is None:
    best=None
    for w in [0,1,2,3,4,6]:
        W=L=0.0
        for lo,hi in BANDS:
            b=bm(lo,hi)
            if (inner_tr&b).sum()<300: continue
            for wins,rate,lot in evaluate(inner_va&b,pick(inner_tr&b,w)):
                n=(inner_va&b).sum(); W+=rate*n; L+=lot*n
        print(f"  안쪽 검증 w={w}: {W/L:.4f}")
        if best is None or W/L>best[1]: best=(w,W/L)
    w=best[0]
else: w=fixed_w
print(f"하한율 {floor} · 평활 폭 w={w}")
table=[]
for lo,hi in BANDS:
    b=bm(lo,hi); ntr=int((tr&b).sum()); nte=int((te&b).sum())
    if ntr<300 or nte<100: print(f"  {lo}~{hi or ''}: 표본 부족(학습 {ntr}, 검증 {nte})"); continue
    ch=pick(tr&b,w); ev=evaluate(te&b,ch)
    print(f"  {lo}~{hi or '':<3} 학습 {ntr:>6,} 검증 {nte:>6,}  " + " | ".join(f"{Gk[j]:.4f} {wins}건 {rate*100:.4f}% 운 {lot*100:.4f}% {rate/lot:.2f}" for j,(wins,rate,lot) in zip(ch,ev)))
    table.append({"lo":lo,"hi":hi,"rounds":nte,"positions":[{"multiple":f"{Gk[j]:.4f}","wins":wins,"rate":f"{rate*100:.6f}","lottery":f"{lot*100:.6f}"} for j,(wins,rate,lot) in zip(ch,ev)]})
json.dump({"floor":floor,"w":w,"bands":table},open(f"rule{floor}_fair.json","w",encoding="utf-8"),ensure_ascii=False,indent=1)
