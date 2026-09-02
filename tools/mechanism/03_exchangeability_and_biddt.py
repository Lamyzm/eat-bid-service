"""모듈 책임: 슬롯이 최대·최소가 될 확률과 개찰 시각 분포로 후보 슬롯의 교환가능성을 검사한다."""

import gzip, re, os, glob, random, statistics as st
from collections import Counter, defaultdict

ROOT = r'F:/Project/eat-bid/data/raw/internal'
files=[]
for d in sorted(os.listdir(ROOT)): files += glob.glob(os.path.join(ROOT,d,'*.xml.gz'))
random.seed(23); samp = random.sample(files, 6000)
DS=re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>',re.S)
ROW=re.compile(r'<Row>(.*?)</Row>',re.S); COL=re.compile(r'<Col id="([^"]+)">(.*?)</Col>',re.S)
def parse(s):
    o={}
    for n,b in DS.findall(s): o[n]=[dict(COL.findall(r)) for r in ROW.findall(b)]
    return o

# A) 강한 교환가능성: 슬롯별 최대/최소/극단성
ismax=Counter(); ismin=Counter(); absdev=defaultdict(list); rate_by_seq=defaultdict(list)
allrates=[]
# B) BID_DT / 중복 BIZ_NO
bidcnt=0; bidwith_dt=0; dup_auctions=0; tot_auctions=0; dupbiz=Counter()
lastchg_ne=0; lastchg_tot=0
nA=0
for p in samp:
    try: s=gzip.open(p,'rt',encoding='utf-8',errors='replace').read()
    except Exception: continue
    d=parse(s)
    pl=d.get('ds_pList') or []
    if len(pl)==15:
        try:
            pr={int(float(r['CMNM_PLNPRC_SN'])):float(r['CMNM_PLNPRC_RT']) for r in pl}
        except Exception: pr=None
        if pr and len(pr)==15:
            nA+=1
            vals=[pr[k] for k in range(1,16)]
            allrates+=vals
            med=st.median(vals)
            mx=max(range(1,16),key=lambda k:pr[k]); mn=min(range(1,16),key=lambda k:pr[k])
            ismax[mx]+=1; ismin[mn]+=1
            for k in range(1,16):
                absdev[k].append(abs(pr[k]-med)); rate_by_seq[k].append(pr[k])
    bl=d.get('ds_bidList') or []
    if bl:
        tot_auctions+=1
        biz=[b.get('BIZ_NO','') for b in bl if b.get('BIZ_NO')]
        c=Counter(biz)
        if any(v>1 for v in c.values()):
            dup_auctions+=1
            for k,v in c.items():
                if v>1: dupbiz[v]+=1
        for b in bl:
            bidcnt+=1
            if b.get('BID_DT'): bidwith_dt+=1
            bd,lc=b.get('BID_DT',''),b.get('LAST_CHG_DT','')
            if bd and lc:
                lastchg_tot+=1
                if bd[:19]!=lc[:19]: lastchg_ne+=1

print('=== A) 강한 교환가능성 검사  n=%d 회차 ===' % nA)
print('기대: 각 슬롯이 최대/최소가 될 확률 = 1/15 = 0.0667')
print(' seq  P(max)   P(min)   E|rate-med|   mean(rate)')
for k in range(1,16):
    print('  %2d  %.4f   %.4f   %.6f    %.6f' % (k, ismax[k]/nA, ismin[k]/nA,
          st.mean(absdev[k]), st.mean(rate_by_seq[k])))
pm=[ismax[k]/nA for k in range(1,16)]; pn=[ismin[k]/nA for k in range(1,16)]
se=(1/15*14/15/nA)**.5
print(' P(max) 범위 %.4f~%.4f  (1/15 +- 2SE = %.4f~%.4f)' % (min(pm),max(pm),1/15-2*se,1/15+2*se))
print(' P(min) 범위 %.4f~%.4f' % (min(pn),max(pn)))
# 카이제곱
chi=sum((ismax[k]-nA/15)**2/(nA/15) for k in range(1,16))
chi2=sum((ismin[k]-nA/15)**2/(nA/15) for k in range(1,16))
print(' 카이제곱(df=14, 5%% 임계 23.68):  P(max) %.2f   P(min) %.2f' % (chi,chi2))
print()
print('=== A2) 비율 분포 모양 (stats-expert 의 평균 불일치 건) ===')
q=sorted(allrates); f=lambda a:q[int(a*(len(q)-1))]
print('  n=%d  mean=%.6f  sd=%.6f  min=%.5f max=%.5f' % (len(q),st.mean(q),st.pstdev(q),q[0],q[-1]))
print('  p05=%.5f p10=%.5f p25=%.5f p50=%.5f p75=%.5f p90=%.5f p95=%.5f'%(f(.05),f(.10),f(.25),f(.50),f(.75),f(.90),f(.95)))
bins=Counter()
for v in q: bins[round((v-0.97)/0.06*20)]+=1
print('  20구간 히스토그램 (균등이면 각 %.1f%%):'%(100/20))
print('   ', ' '.join('%.2f'%(bins[i]/len(q)*100) for i in range(20)))
print('  1.0 미만 비율 %.4f  (균등이면 0.5000)' % (sum(1 for v in q if v<1.0)/len(q)))
print()
print('=== B) BID_DT / 투찰 정정 ===')
print('  투찰행 %d 중 BID_DT 채움 %d = %.4f' % (bidcnt,bidwith_dt,bidwith_dt/bidcnt if bidcnt else 0))
print('  회차 %d 중 같은 BIZ_NO 가 2행 이상인 회차: %d = %.4f' % (tot_auctions,dup_auctions,dup_auctions/tot_auctions if tot_auctions else 0))
print('  중복 행수 분포:', dupbiz.most_common(5))
print('  BID_DT != LAST_CHG_DT 인 투찰: %d / %d = %.4f' % (lastchg_ne,lastchg_tot,lastchg_ne/lastchg_tot if lastchg_tot else 0))
