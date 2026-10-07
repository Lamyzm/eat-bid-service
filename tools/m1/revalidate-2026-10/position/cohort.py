"""모듈 책임: 두 기간 모두 z가 1.5를 넘는 지속 상위 업체와 중간 업체 집단을 만든다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; win=z['is_recorded_winner']; wd=z['wd']; ym=z['ym']; biz=z['biz_no']
Rs=z['R_suspect']; x=z['x']; R=z['R']; t=z['t']; nbid=z['nbid']
rounds=np.repeat(np.arange(len(cnt)),cnt)
live=~wd
Nl=np.bincount(rounds[live],minlength=len(cnt))
ok=live&(~Rs[rounds])&(Nl[rounds]>0)
p=np.where(ok,1.0/np.maximum(Nl[rounds],1),0.0)
ub,inv=np.unique(biz,return_inverse=True)
def st(mask):
    e=np.bincount(inv[mask],weights=p[mask],minlength=len(ub))
    v=np.bincount(inv[mask],weights=(p*(1-p))[mask],minlength=len(ub))
    a=np.bincount(inv[mask],weights=win[mask].astype(float),minlength=len(ub))
    c=np.bincount(inv[mask],minlength=len(ub))
    return e,v,a,c
D=ok&(ym[rounds]<=202512); M=ok&(ym[rounds]>=202601)
E1,V1,A1,C1=st(D); E2,V2,A2,C2=st(M)
with np.errstate(all='ignore'):
    z1=(A1-E1)/np.sqrt(V1); z2=(A2-E2)/np.sqrt(V2)
vol=(C1>=300)&(C2>=100)
elite=vol&(z1>1.5)&(z2>1.5)
mid  =vol&(np.abs(z1)<0.7)&(np.abs(z2)<0.7)
print(f"충분참여 업체 {int(vol.sum()):,}")
print(f"  지속 고수 (두 기간 z>1.5): {int(elite.sum()):,}")
print(f"  중간      (두 기간 |z|<0.7): {int(mid.sum()):,}")
for nm,m in [("고수",elite),("중간",mid)]:
    if m.sum()==0: continue
    print(f"  {nm}: 배수 중앙 {np.median((A1[m]+A2[m])/(E1[m]+E2[m])):.3f}  "
          f"투찰 중앙 {int(np.median(C1[m]+C2[m]))}")
np.save("elite.npy",ub[elite]); np.save("mid.npy",ub[mid])
F=['3118152843','7175001228']
for f in F:
    i=np.where(ub==f)[0][0]
    print(f"  아버지 {f}: z1={z1[i]:+.2f} z2={z2[i]:+.2f} 투찰 {int(C1[i]+C2[i])}")
