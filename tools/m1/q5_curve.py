# -*- coding: utf-8 -*-
"""Q5 — w(x): 투찰 위치별 기대 낙찰률 곡선. M1(구조) 경로.

data-inventory 가 경험적 반사실(replay)로 같은 곡선을 낸다.
🔴 서로 안 보고 각자 낸다. 둘이 맞으면 독립 경로 재현이고,
   다르면 M1 의 F_X 가 그 층에서 틀렸거나 반사실 계산에 뭔가 있다.

평가 2026-01~08 · N≤2 분리 · α=0.03 고정(P(α|z) 는 아직 게이트 통과 전).
"""
from __future__ import annotations

import numpy as np

# 🔴 봉인 경계 (2026-09-02 팀리드 확정): TUNE = 202601~202605.  202606~ 는 HOLD_A/HOLD_B.
#    이 스크립트는 봉인 이전에 작성돼 평가창이 `ym >= 202601` 이었다 = 봉인을 넘는다.
#    창을 TUNE 으로 좁힌다.  넓히려면 팀리드 서면 승인이 필요하다.
_SEAL_MAX = 202605

from fr import FR
from m1 import M1, n_bucket

A = np.load(r'F:/Project/eat-bid/data/mechanism/xcap.npz', allow_pickle=True)
B = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
x, cnt, R, nbid = (A['x'].astype(np.float64), A['off'], A['R'],
                   A['nbid'].astype(int))
bi = {b: i for i, b in enumerate(B['bid_id'])}
k = np.array([bi.get(b, -1) for b in A['bid_id']])
ym = np.where(k >= 0, B['ym'][np.clip(k, 0, None)], -1).astype(int)
bgng = np.where(k >= 0, B['bgng'][np.clip(k, 0, None)], np.nan)
aid = np.repeat(np.arange(len(R)), cnt)

nb = n_bucket(nbid)
bq = np.digitize(bgng, np.nanpercentile(bgng[ym <= 202512], [20, 40, 60, 80]))
stratum = np.where(nb <= 3, nb * 10 + bq, nb * 10)
tr_a = (ym <= 202512) & (nbid >= 3)
te_a = (ym >= 202601) & (ym <= _SEAL_MAX) & (nbid >= 3)

xgrid = np.linspace(0.94, 1.10, 3201)
m = M1(FR(n=300000, seed=2)).fit(x[tr_a[aid]], stratum[aid][tr_a[aid]], xgrid)

curve = np.arange(0.975, 1.0301, 0.0025)
print('=== Q5  w(x): 투찰 위치별 기대 낙찰률 (M1 구조 경로) ===')
print('평가 회차 %d (2026-01~08, N>=3)\n' % te_a.sum())
buckets = [(3, 4, 'N=3-4'), (5, 9, 'N=5-9'), (10, 29, 'N=10-29'),
           (30, 99, 'N=30-99'), (100, 10 ** 9, 'N=100+')]
hdr = ' '.join('%7s' % b[2] for b in buckets)
print('%-8s %8s  %s' % ('x', '전체', hdr))
rows = {}
for xi in curve:
    cell = []
    tot_n = tot_p = 0.0
    for lo, hi, lab in buckets:
        q = np.flatnonzero(te_a & (nbid >= lo) & (nbid <= hi))
        if len(q) < 50:
            cell.append(np.nan)
            continue
        s = np.random.default_rng(0).choice(q, min(len(q), 3000), replace=False)
        p = np.array([m.win_prob(xi, int(nbid[i]), stratum[i], 0.03)[0]
                      for i in s]).mean()
        cell.append(p)
        tot_n += len(q)
        tot_p += p * len(q)
    rows[xi] = cell
    print('%-8.4f %8.4f  %s'
          % (xi, tot_p / max(tot_n, 1), ' '.join('%7.4f' % c for c in cell)))

print('\n=== 층별 최적 x (구조가 내는 뒤집힘) ===')
for i, (_, _, lab) in enumerate(buckets):
    col = np.array([rows[xi][i] for xi in curve])
    if np.all(np.isnan(col)):
        continue
    j = int(np.nanargmax(col))
    print('  %-9s 최적 x = %.4f   최대 w = %.4f' % (lab, curve[j], col[j]))
