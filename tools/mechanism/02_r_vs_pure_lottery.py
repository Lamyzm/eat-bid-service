import gzip, re, os, glob, random, statistics as st, itertools
from collections import Counter

ROOT = r'F:/Project/eat-bid/data/raw/internal'
files=[]
for d in sorted(os.listdir(ROOT)): files += glob.glob(os.path.join(ROOT,d,'*.xml.gz'))
random.seed(11); samp = random.sample(files, 3000)

DS=re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>',re.S)
ROW=re.compile(r'<Row>(.*?)</Row>',re.S); COL=re.compile(r'<Col id="([^"]+)">(.*?)</Col>',re.S)
def parse(s):
    o={}
    for n,b in DS.findall(s): o[n]=[dict(COL.findall(r)) for r in ROW.findall(b)]
    return o

allrates=[]; Robs=[]; Rsim=[]; spans=[]; ndistinct=Counter()
rng=random.Random(3)
for p in samp:
    try: s=gzip.open(p,'rt',encoding='utf-8',errors='replace').read()
    except Exception: continue
    pl=parse(s).get('ds_pList') or []
    if len(pl)!=15: continue
    try: rates=[float(r['CMNM_PLNPRC_RT']) for r in pl]
    except Exception: continue
    ch=[r.get('CHC_YN','')=='Y' for r in pl]
    if sum(ch)!=4: continue
    allrates += rates
    spans.append(max(rates)-min(rates))
    ndistinct[len(set(rates))]+=1
    Robs.append(sum(r for r,c in zip(rates,ch) if c)/4)
    Rsim.append(sum(rng.sample(rates,4))/4)          # 순수 추첨 대조군: 같은 15개에서 4개 균등 추출

print('=== 예비가격 비율(CMNM_PLNPRC_RT) 분포 ===')
print('  n=%d  min=%.5f  max=%.5f  mean=%.6f  sd=%.6f' % (len(allrates),min(allrates),max(allrates),st.mean(allrates),st.pstdev(allrates)))
q=sorted(allrates); f=lambda a: q[int(a*(len(q)-1))]
print('  p1=%.4f p25=%.4f p50=%.4f p75=%.4f p99=%.4f' % (f(.01),f(.25),f(.5),f(.75),f(.99)))
print('  15개 중 distinct 값 개수 분포:', ndistinct.most_common(3))
print('  회차 내 span(max-min) 평균 %.5f  중앙값 %.5f' % (st.mean(spans), st.median(spans)))
print()
print('=== 실제 R  vs  같은 15개에서 4개 균등추출한 R (순수추첨 대조군) ===')
print('  실제   n=%5d  mean=%.6f  sd=%.6f  p5=%.5f p95=%.5f' % (
    len(Robs), st.mean(Robs), st.pstdev(Robs), sorted(Robs)[len(Robs)//20], sorted(Robs)[len(Robs)*19//20]))
print('  대조군 n=%5d  mean=%.6f  sd=%.6f  p5=%.5f p95=%.5f' % (
    len(Rsim), st.mean(Rsim), st.pstdev(Rsim), sorted(Rsim)[len(Rsim)//20], sorted(Rsim)[len(Rsim)*19//20]))
print('  sd 비율 실제/대조군 = %.4f' % (st.pstdev(Robs)/st.pstdev(Rsim)))
# 2-표본 KS
import bisect
A=sorted(Robs); B=sorted(Rsim); allv=sorted(set(A+B))
d=max(abs(bisect.bisect_right(A,v)/len(A)-bisect.bisect_right(B,v)/len(B)) for v in allv)
crit=1.36*((1/len(A)+1/len(B))**.5)
print('  KS D=%.4f  임계값(5%%)=%.4f  ->  %s' % (d,crit,'분포 다름' if d>crit else '분포 구분 안 됨'))
