"""모듈 책임: 투찰 시각 t로 마감 1시간 전 참여 수 N(T-1h)를 복원해 문서의 도착 통계(중앙 99.3%·p10 84.0%)와 대조한다."""
import numpy as np, sys, io
sys.stdout=io.TextIOWrapper(sys.stdout.buffer,encoding='utf-8')
b=r"F:/Project/eat-bid/data/mechanism"
z=np.load(b+"/xcap2.npz",allow_pickle=True)
cnt=z['off']; t=z['t']; wd=z['wd']; nbid=z['nbid']; Rs=z['R_suspect']
rounds=np.repeat(np.arange(len(cnt)),cnt)
live=~wd
print("t 분위:",np.round(np.percentile(t[live],[1,10,50,90,99]),3).tolist())
for thr,lab in [(1.0,"t>=1"),(0.0,"t>=0")]:
    c=np.bincount(rounds[live&(t>=thr)],minlength=len(cnt))
    ok=(~Rs)&(nbid>=3)
    r=c[ok]/np.maximum(nbid[ok],1)
    print(f"{lab:6s} 복원 N / 최종 N :  중앙 {np.median(r)*100:.1f}%  p10 {np.percentile(r,10)*100:.1f}%  "
          f"90%이상 비율 {np.mean(r>=0.9)*100:.1f}%")
print("\n문서: 중앙 99.3% · p10 84.0% · 회차의 83.5%가 90%이상")
