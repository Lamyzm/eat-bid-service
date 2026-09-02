"""모듈 책임: 후보 15개의 1.0 기준 분할과 최대 간격 위치를 세어, 아래 8 / 위 7 밴드 구조를 확인한다."""

import gzip, re, os, glob, random, statistics as st
from collections import Counter
ROOT=r'F:/Project/eat-bid/data/raw/internal'
files=[]
for d in sorted(os.listdir(ROOT)): files+=glob.glob(os.path.join(ROOT,d,'*.xml.gz'))
random.seed(59); samp=random.sample(files,8000)
DS=re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>',re.S)
ROW=re.compile(r'<Row>(.*?)</Row>',re.S); COL=re.compile(r'<Col id="([^"]+)">(.*?)</Col>',re.S)
def parse(s):
    o={}
    for n,b in DS.findall(s): o[n]=[dict(COL.findall(r)) for r in ROW.findall(b)]
    return o
below=Counter(); gappos=Counter(); lo_sd=[]; hi_sd=[]; lo_m=[]; hi_m=[]; n=0
lo_min=[];lo_max=[];hi_min=[];hi_max=[]
for p in samp:
    try: s=gzip.open(p,'rt',encoding='utf-8',errors='replace').read()
    except Exception: continue
    pl=parse(s).get('ds_pList') or []
    if len(pl)!=15: continue
    try: r=sorted(float(x['CMNM_PLNPRC_RT']) for x in pl)
    except Exception: continue
    n+=1
    below[sum(1 for v in r if v<1.0)]+=1
    g=[r[i+1]-r[i] for i in range(14)]
    gappos[max(range(14),key=lambda i:g[i])+1]+=1
    lo,hi=r[:8],r[8:]
    lo_m.append(st.mean(lo)); hi_m.append(st.mean(hi))
    lo_sd.append(st.pstdev(lo)); hi_sd.append(st.pstdev(hi))
    lo_min.append(lo[0]); lo_max.append(lo[-1]); hi_min.append(hi[0]); hi_max.append(hi[-1])
print('회차 n=%d'%n)
print('\n=== 1.0 미만인 후보 개수 (회차별) ===')
for k,v in sorted(below.items()): print('   %2d개  %6d  %.4f' % (k,v,v/n))
print('\n=== 최대 간격의 위치 (정렬 후 i번째와 i+1번째 사이) ===')
for k,v in sorted(gappos.items(), key=lambda x:-x[1])[:6]: print('   %2d|%-2d  %6d  %.4f' % (k,k+1,v,v/n))
print('\n=== 아래 8개 / 위 7개 로 자른 두 덩어리 ===')
print('  아래8  min %.5f~%.5f (평균 %.5f)   max 평균 %.5f   내부sd 평균 %.6f   덩어리평균 %.6f'
      % (min(lo_min),max(lo_min),st.mean(lo_min),st.mean(lo_max),st.mean(lo_sd),st.mean(lo_m)))
print('  위 7   min 평균 %.5f   max %.5f~%.5f (평균 %.5f)  내부sd 평균 %.6f   덩어리평균 %.6f'
      % (st.mean(hi_min),min(hi_max),max(hi_max),st.mean(hi_max),st.mean(hi_sd),st.mean(hi_m)))
print('\n  두 덩어리 평균의 회차간 sd:  아래 %.6f   위 %.6f' % (st.pstdev(lo_m), st.pstdev(hi_m)))
print('  8/15 = %.4f' % (8/15))
