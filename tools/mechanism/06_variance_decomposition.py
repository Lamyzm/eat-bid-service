"""모듈 책임: 커트라인 R 의 산포를 회차 간 후보 평균과 회차 내 선택 산포로 분해해 귀무 기댓값과 대조한다."""

import gzip, re, os, glob, random, statistics as st
ROOT = r'F:/Project/eat-bid/data/raw/internal'
files=[]
for d in sorted(os.listdir(ROOT)): files += glob.glob(os.path.join(ROOT,d,'*.xml.gz'))
random.seed(41); samp = random.sample(files, 8000)
DS=re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>',re.S)
ROW=re.compile(r'<Row>(.*?)</Row>',re.S); COL=re.compile(r'<Col id="([^"]+)">(.*?)</Col>',re.S)
def parse(s):
    o={}
    for n,b in DS.findall(s): o[n]=[dict(COL.findall(r)) for r in ROW.findall(b)]
    return o

R=[]; M=[]; D=[]; V=[]; spans=[]; gaps=[[] for _ in range(14)]
for p in samp:
    try: s=gzip.open(p,'rt',encoding='utf-8',errors='replace').read()
    except Exception: continue
    pl=parse(s).get('ds_pList') or []
    if len(pl)!=15: continue
    try: rates=[float(r['CMNM_PLNPRC_RT']) for r in pl]
    except Exception: continue
    ch=[r.get('CHC_YN','')=='Y' for r in pl]
    if sum(ch)!=4: continue
    m=sum(rates)/15; r4=sum(x for x,c in zip(rates,ch) if c)/4
    v=sum((x-m)**2 for x in rates)/15
    R.append(r4); M.append(m); D.append(r4-m); V.append(v)
    sr=sorted(rates); spans.append(sr[-1]-sr[0])
    for i in range(14): gaps[i].append(sr[i+1]-sr[i])

n=len(R)
vR=st.pvariance(R); vM=st.pvariance(M); vD=st.pvariance(D)
EvarD=sum(v/4*(11/14) for v in V)/n
print('=== 분산 분해  R_i = mean(r_i) + D_i   n=%d ===' % n)
print('  sd(R)            %.7f   <- 회차 간 R 의 산포 (E3 가 필요한 값)' % vR**.5)
print('  sd(mean(r_i))    %.7f   <- 회차별 후보 평균의 산포' % vM**.5)
print('  sd(D)            %.7f   <- 회차 내 선택 산포 (리더의 0.0074286)' % vD**.5)
print('  귀무 E[Var(D)]^.5 %.7f   <- (v/4)(11/14) 평균의 제곱근' % EvarD**.5)
print()
print('  분해 검산  Var(M)+Var(D) = %.9f   vs  Var(R) = %.9f   비 %.4f'
      % (vM+vD, vR, (vM+vD)/vR))
print('  Cov(M,D) = %.3e  (0 이어야 함)' % (st.pvariance([m+d for m,d in zip(M,D)])-vM-vD)/2 if 0 else '')
cov=(st.pvariance([m+d for m,d in zip(M,D)])-vM-vD)/2
print('  Cov(M,D) = %.3e   상관 %.4f' % (cov, cov/(vM*vD)**.5))
print()
print('=== 후보 15개가 iid 인가? ===')
vbar=sum(V)/n
print('  회차 내 모분산 평균 v_bar = %.8f   (sd %.6f)' % (vbar, vbar**.5))
print('  iid 라면 sd(mean(r_i)) = sqrt(v_bar/15) = %.7f' % (vbar/15)**.5)
print('  실측                    sd(mean(r_i)) = %.7f' % vM**.5)
print('  비 = %.4f      -> 1 에 가까우면 iid, 0 에 가까우면 평균이 고정돼 있다' % (vM**.5/(vbar/15)**.5))
print()
print('  회차 내 sd 의 산포: mean %.6f  sd %.6f  cv %.4f'
      % (st.mean([v**.5 for v in V]), st.pstdev([v**.5 for v in V]),
         st.pstdev([v**.5 for v in V])/st.mean([v**.5 for v in V])))
print('  span(max-min): mean %.5f  sd %.5f   (iid 균등 15개면 E[range]=0.0525)' % (st.mean(spans), st.pstdev(spans)))
print()
print('  정렬 후 인접 간격 평균 (iid 균등이면 전부 ~0.00375, 계통추출이면 균일하고 분산 작음):')
print('   ', ' '.join('%.5f'%st.mean(g) for g in gaps))
print('  간격의 cv  :', ' '.join('%.2f'%(st.pstdev(g)/st.mean(g)) for g in gaps))
