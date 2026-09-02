import gzip, re, os, glob, random, statistics as st
from collections import Counter, defaultdict

ROOT = r'F:/Project/eat-bid/data/raw/internal'
files = []
for d in sorted(os.listdir(ROOT)):
    files += glob.glob(os.path.join(ROOT, d, '*.xml.gz'))
print('total files', len(files))
random.seed(7)
samp = random.sample(files, 4000)

DS = re.compile(r'<Dataset id="([^"]+)">(.*?)</Dataset>', re.S)
ROW = re.compile(r'<Row>(.*?)</Row>', re.S)
COL = re.compile(r'<Col id="([^"]+)">(.*?)</Col>', re.S)

def parse(s):
    out = {}
    for name, body in DS.findall(s):
        rows = []
        for r in ROW.findall(body):
            rows.append(dict(COL.findall(r)))
        out[name] = rows
    return out

spear = []           # per-auction rank corr(seq, rate)
chc_by_seq = Counter()
seq_total = Counter()
chc_by_seq_n = defaultdict(Counter)   # nbucket -> seq -> chosen
seq_tot_n = defaultdict(Counter)
r_by_n = defaultdict(list)
drawno_vals = Counter()
n_draw_present = 0; n_bids_total = 0
npl = Counter()

def rankcorr(xs, ys):
    n = len(xs)
    rx = {v:i for i,v in enumerate(sorted(range(n), key=lambda i: xs[i]))}
    ry = {v:i for i,v in enumerate(sorted(range(n), key=lambda i: ys[i]))}
    d2 = sum((rx[i]-ry[i])**2 for i in range(n))
    return 1 - 6*d2/(n*(n*n-1))

ok = 0
for p in samp:
    try:
        s = gzip.open(p,'rt',encoding='utf-8',errors='replace').read()
    except Exception:
        continue
    d = parse(s)
    pl = d.get('ds_pList') or []
    npl[len(pl)] += 1
    if len(pl) != 15:
        continue
    try:
        seqs  = [int(float(r['CMNM_PLNPRC_SN'])) for r in pl]
        rates = [float(r['CMNM_PLNPRC_RT'])       for r in pl]
    except Exception:
        continue
    chosen = [r.get('CHC_YN','') == 'Y' for r in pl]
    if sum(chosen) != 4:
        continue
    ok += 1
    spear.append(rankcorr(seqs, rates))

    bl = d.get('ds_bidList') or []
    N = len(bl)
    n_bids_total += N
    n_draw_present += sum(1 for b in bl if b.get('DRAW_NO'))
    for b in bl:
        v = b.get('DRAW_NO')
        if v: drawno_vals[v] += 1
    nb = 1 if N<=3 else 2 if N<=6 else 3 if N<=12 else 4
    for sq, ch in zip(seqs, chosen):
        seq_total[sq]+=1; seq_tot_n[nb][sq]+=1
        if ch:
            chc_by_seq[sq]+=1; chc_by_seq_n[nb][sq]+=1
    R = sum(rt for rt,ch in zip(rates,chosen) if ch)/4
    r_by_n[nb].append(R)

print('parsed 15-row auctions:', ok)
print('ds_pList row-count dist:', npl.most_common(6))
print()
print('=== TEST 1: seq -> price rank correlation (per auction Spearman) ===')
print('  mean %.5f  median %.5f  sd %.4f  n=%d' % (
    st.mean(spear), st.median(spear), st.pstdev(spear), len(spear)))
print('  |rho|>0.5 fraction: %.3f' % (sum(1 for x in spear if abs(x)>0.5)/len(spear)))
print()
print('=== TEST 2: P(chosen | seq), marginal (pure lottery => 4/15 = 0.2667) ===')
for sq in range(1,16):
    t = seq_total[sq]
    print('  seq %2d  n=%6d  P=%.4f' % (sq, t, chc_by_seq[sq]/t if t else 0))
print()
print('=== TEST 3: P(chosen | seq, N bucket) ===')
lbl = {1:'N<=3',2:'N 4-6',3:'N 7-12',4:'N>12'}
for nb in sorted(seq_tot_n):
    row = [chc_by_seq_n[nb][sq]/seq_tot_n[nb][sq] if seq_tot_n[nb][sq] else 0 for sq in range(1,16)]
    lo = sum(row[:5])/5; hi = sum(row[-5:])/5
    print('  %-7s auctions=%5d  seq1-5 avg=%.4f  seq11-15 avg=%.4f  diff=%+.4f' %
          (lbl[nb], len(r_by_n[nb]), lo, hi, lo-hi))
    print('           ', ' '.join('%.3f'%v for v in row))
print()
print('=== TEST 4: R distribution by N bucket ===')
for nb in sorted(r_by_n):
    v = r_by_n[nb]
    if len(v)>2:
        print('  %-7s n=%5d  mean=%.6f  sd=%.6f' % (lbl[nb], len(v), st.mean(v), st.pstdev(v)))
print()
print('=== TEST 5: DRAW_NO ===')
print('  bids with DRAW_NO: %d / %d = %.4f' % (n_draw_present, n_bids_total,
      n_draw_present/n_bids_total if n_bids_total else 0))
print('  distinct DRAW_NO values:', len(drawno_vals))
print('  top 10:', drawno_vals.most_common(10))
print('  bottom 5:', drawno_vals.most_common()[-5:])
