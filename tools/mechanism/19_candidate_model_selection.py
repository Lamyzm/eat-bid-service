import numpy as np
P=np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz',allow_pickle=True)
rate=P['rate']; n=len(rate)
obs_mean_sd=rate.mean(1).std(ddof=1)
obs_R=( (rate*P['chosen']).sum(1)/4 ).std(ddof=1)
vbar=rate.var(1,ddof=0).mean()
print('실측  sd(15개 평균) = %.6f   sd(R) = %.6f   회차내 모분산 평균 = %.8f'%(obs_mean_sd,obs_R,vbar))
print()
rng=np.random.default_rng(3); m=200000
print('=== 후보군 세 모형의 sd(15개 평균) ===')
# A: 15개 전부 U(0.97,1.03) iid
A=rng.uniform(0.97,1.03,(m,15)).mean(1).std(ddof=1)
# B: 8개 ~ U(0.97,1.00) iid + 7개 ~ U(1.00,1.03) iid   (내 "8/7", stats-expert 의 "IID")
B=np.concatenate([rng.uniform(0.97,1.00,(m,8)),rng.uniform(1.00,1.03,(m,7))],1).mean(1).std(ddof=1)
# C: 15구간 계통추출 (각 1/15 구간에서 하나씩)
e=np.linspace(0.97,1.03,16)
C=(e[:-1]+rng.uniform(0,1,(m,15))*(e[1:]-e[:-1])).mean(1).std(ddof=1)
for lbl,v in [('A  15개 전부 U(0.97,1.03) iid',A),
              ('B  8~U(.97,1.00) + 7~U(1.00,1.03)  (내 8/7 = stats-expert IID)',B),
              ('C  15구간 계통추출 (stats-expert 가 부른 "층화")',C)]:
    print('  %-58s %.6f   실측대비 %.3f'%(lbl,v,v/obs_mean_sd))
print()
print('=== %<1.0 로도 가르나 ===')
print('  실측 %.4f'%np.mean(rate<1.0))
print('  A %.4f · B %.4f · C %.4f'%(
  np.mean(rng.uniform(0.97,1.03,(50000,15))<1.0),
  8/15,
  np.mean((e[:-1]+rng.uniform(0,1,(50000,15))*(e[1:]-e[:-1]))<1.0)))
print()
print('  🔴 sd(15개 평균)만이 셋을 가른다.  실측 %.6f 는 B 와 맞는다.'%obs_mean_sd)
