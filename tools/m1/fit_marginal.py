# -*- coding: utf-8 -*-
"""α 주변화판 보정 곡선 — 사전 등록한 예측의 시험.

    f_R(r|z) = P(α=.02|z)·f_R(r|.02) + P(α=.03|z)·f_R(r|.03)

낙찰 확률은 f_R 에 대해 선형이므로 두 α 의 승률을 각각 내서 섞으면 된다.

🔴 사전 등록한 예측 (개정 20, 결과 보기 전에 적었다):
    α=0.03 고정판에서 상위 두 십분위가 각각 +9% · +13% 과소예측했다.
    α 가 낮으면 R 이 좁아 최적 x 근처 승률이 높으므로 그 방향이 맞다.
    ⟹ 주변화를 넣으면 상위 두 십분위의 미보정이 줄어야 한다.
    ⟹ 안 줄면 원인은 α 가 아니라 F_X 다.

P(α|z): 체제 후 전부(2025-07~12) 학습 · 축소 s=3 (Brier 최소) · 절편 전진 재보정.
"""
from __future__ import annotations

import numpy as np

# 🔴 봉인 경계 (2026-09-02 팀리드 확정): TUNE = 202601~202605.  202606~ 는 HOLD_A/HOLD_B.
#    이 스크립트는 봉인 이전에 작성돼 평가창이 `ym >= 202601` 이었다 = 봉인을 넘는다.
#    창을 TUNE 으로 좁힌다.  넓히려면 팀리드 서면 승인이 필요하다.
_SEAL_MAX = 202605

from fr import FR
from m1 import M1, n_bucket
import p_alpha_gate as PA

A = np.load(r'F:/Project/eat-bid/data/mechanism/xcap.npz', allow_pickle=True)
B = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
x, cnt, R, nbid = (A['x'].astype(np.float64), A['off'], A['R'],
                   A['nbid'].astype(int))
bi = {b: i for i, b in enumerate(B['bid_id'])}
k = np.array([bi.get(b, -1) for b in A['bid_id']])
ym = np.where(k >= 0, B['ym'][np.clip(k, 0, None)], -1).astype(int)
bgng = np.where(k >= 0, B['bgng'][np.clip(k, 0, None)], np.nan)

# P(α 낮음 | z) — asof 순서로 나온 것을 xcap 순서로 옮긴다
p_raw, glob = PA.fit(3.0)
p_raw = PA.recal_forward(p_raw, glob)
pmap = {b: p for b, p in zip(B['bid_id'], p_raw)}
p_low = np.array([pmap.get(b, glob) for b in A['bid_id']])

aid = np.repeat(np.arange(len(R)), cnt)
nb = n_bucket(nbid)
bq = np.digitize(bgng, np.nanpercentile(bgng[ym <= 202512], [20, 40, 60, 80]))
stratum = np.where(nb <= 3, nb * 10 + bq, nb * 10)
tr_a = (ym <= 202512) & (nbid >= 3)
te_a = (ym >= 202601) & (ym <= _SEAL_MAX) & (nbid >= 3)

xgrid = np.linspace(0.94, 1.10, 3201)
m = M1(FR(n=300000, seed=2)).fit(x[tr_a[aid]], stratum[aid][tr_a[aid]], xgrid)

valid = x >= R[aid]
xv = np.where(valid, x, 1e9)
order = np.lexsort((xv, aid))
first = np.ones(len(x), bool)
first[1:] = aid[order][1:] != aid[order][:-1]
win = np.zeros(len(x), bool)
wi = order[first]
win[wi] = valid[wi]

sel = te_a[aid]
xi, ai = x[sel], aid[sel]
act = win[sel]
pl = p_low[ai]
print('평가 투찰 %d · 실제 낙찰률 %.4f · P(α낮음) 평균 %.4f'
      % (len(xi), act.mean(), pl.mean()))


def predict(alpha_mode):
    out = np.empty(len(xi))
    for s in np.unique(stratum[ai]):
        q = stratum[ai] == s
        for n in np.unique(nbid[ai][q]):
            qq = q & (nbid[ai] == n)
            if not qq.any():
                continue
            if alpha_mode == 'fixed':
                out[qq] = m.win_prob(xi[qq], int(n), s, 0.03)
            else:
                a2 = m.win_prob(xi[qq], int(n), s, 0.02)
                a3 = m.win_prob(xi[qq], int(n), s, 0.03)
                out[qq] = pl[qq] * a2 + (1 - pl[qq]) * a3
    return out


print('\n=== 사전 등록한 예측의 시험: 상위 두 십분위 미보정이 줄었나 ===')
res = {}
for mode in ('fixed', 'marginal'):
    p = predict(mode)
    e = np.percentile(p, np.arange(0, 101, 10))
    rows = []
    for i in range(10):
        q = (p >= e[i]) & (p < e[i + 1] if i < 9 else p <= e[10])
        if q.sum() < 50:
            continue
        rows.append((p[q].mean(), act[q].mean(), q.sum()))
    res[mode] = rows
    print('\n  --- %s' % ('α=0.03 고정' if mode == 'fixed' else 'α 주변화'))
    for i, (pp, oo, nn) in enumerate(rows):
        mark = '  <-- 상위 두 십분위' if i >= len(rows) - 2 else ''
        print('    D%-2d n=%7d  예측 %.4f  관측 %.4f  상대오차 %+7.1f%%%s'
              % (i + 1, nn, pp, oo, 100 * (pp / oo - 1), mark))

print('\n=== 판정 ===')
for i in (-2, -1):
    f = res['fixed'][i]
    g = res['marginal'][i]
    ef, eg = abs(f[0] / f[1] - 1), abs(g[0] / g[1] - 1)
    print('  상위 %d번째 십분위  고정 %+.1f%% → 주변화 %+.1f%%   %s'
          % (abs(i), 100 * (f[0] / f[1] - 1), 100 * (g[0] / g[1] - 1),
             '줄었다' if eg < ef else '🔴 안 줄었다'))
print('\n  예측이 맞으면 인과 사슬이 닫히고, 틀리면 범인은 F_X 로 확정된다.')
