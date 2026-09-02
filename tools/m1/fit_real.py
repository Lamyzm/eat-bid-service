# -*- coding: utf-8 -*-
"""M1 실데이터 적합 + 보정 곡선 — M1 의 실패 판정.

🔴 판정 기준을 결과 보기 전에 못박는다 (team-lead 의 CI 방향 교정 반영):

    "효과가 크다" 주장  →  CI 하한을 본다
    "효과가 작다" 주장  →  CI 상한을 본다
    같은 문서에서 둘이 섞이면 반드시 틀린다

    실패 판정 1  보정 곡선이 대각선에서 벗어난다  ← "크다" 주장 → CI 하한
                 판정: |관측 − 예측| 의 CI 하한이 0.02 를 넘는 십분위가 3개 이상
    실패 판정 2  M1 이 기준선(고정 x)을 못 이긴다  ← "작다" 주장이 아니라 "크다" 주장
                 판정: 낙찰수 개선폭의 CI 하한 > 0

    ⚠ "M4 에 크게 지지 않는다" 같은 형태를 쓸 거면 그건 "작다" 주장이라 CI 상한이다.
      지금 이 파일에는 그 형태가 없다 — 넣을 때 이 주석을 같이 읽어라.

분할: 학습 2023-09~2025-12 / 평가 2026-01~08. 무작위 분할 금지.
N≤2 는 분리한다 (SBC·T1 층·순열 귀무 세 곳에서 같은 제외가 걸린다).
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
x, cnt, R, nbid, ym = (A['x'].astype(np.float64), A['off'], A['R'],
                       A['nbid'].astype(int), None)
B = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
bidx = {b: i for i, b in enumerate(B['bid_id'])}
k = np.array([bidx.get(b, -1) for b in A['bid_id']])
ym = np.where(k >= 0, B['ym'][np.clip(k, 0, None)], -1).astype(int)
bgng = np.where(k >= 0, B['bgng'][np.clip(k, 0, None)], np.nan)

start = np.concatenate([[0], np.cumsum(cnt)[:-1]])
aid = np.repeat(np.arange(len(R)), cnt)               # 투찰 -> 회차

# 낙찰자: R 이상 중 최저
valid = x >= R[aid]
BIG = 1e9
xv = np.where(valid, x, BIG)
order = np.lexsort((xv, aid))
first = np.ones(len(x), bool)
first[1:] = aid[order][1:] != aid[order][:-1]
win = np.zeros(len(x), bool)
w_idx = order[first]
win[w_idx] = valid[w_idx]

nb = n_bucket(nbid)
bq = np.digitize(bgng, np.nanpercentile(bgng[ym <= 202512], [20, 40, 60, 80]))
stratum = np.where(nb <= 3, nb * 10 + bq, nb * 10)
tr_a = (ym <= 202512) & (nbid >= 3)                   # N<=2 분리
te_a = (ym >= 202601) & (ym <= _SEAL_MAX) & (nbid >= 3)
print('학습 회차 %d · 평가 회차 %d  (N<=2 제외)' % (tr_a.sum(), te_a.sum()))

xgrid = np.linspace(0.94, 1.10, 3201)
m = M1(FR(n=300000, seed=2)).fit(x[tr_a[aid]], stratum[aid][tr_a[aid]], xgrid)

# 평가: 각 투찰의 예측 승률 vs 실제 낙찰
sel = te_a[aid]
xi, ai = x[sel], aid[sel]
pred = np.empty(len(xi))
for s in np.unique(stratum[ai]):
    q = stratum[ai] == s
    for n in np.unique(nbid[ai][q]):
        qq = q & (nbid[ai] == n)
        if not qq.any():
            continue
        pred[qq] = m.win_prob(xi[qq], int(n), s, 0.03)
act = win[sel]
print('평가 투찰 %d · 실제 낙찰률 %.4f · 예측 평균 %.4f'
      % (len(xi), act.mean(), pred.mean()))

print('\n=== 보정 곡선 (예측 십분위) ===')
print('  %-14s %9s %9s %9s %10s' % ('구간', 'n', '예측', '관측', '차 CI하한'))
e = np.percentile(pred, np.arange(0, 101, 10))
bad = 0
for i in range(10):
    q = (pred >= e[i]) & (pred < e[i + 1] if i < 9 else pred <= e[10])
    if q.sum() < 50:
        continue
    p, o = pred[q].mean(), act[q].mean()
    se = np.sqrt(max(o * (1 - o), 1e-9) / q.sum())
    lo = abs(o - p) - 1.96 * se
    bad += lo > 0.02
    print('  [%.4f,%.4f) %9d %9.4f %9.4f %10.4f'
          % (e[i], e[i + 1], q.sum(), p, o, lo))
print('\n  |관측−예측| CI하한 > 0.02 인 십분위: %d 개  (실패 판정 문턱 3)' % bad)
print('  판정: %s' % ('🔴 실패 — R 이 확정이므로 틀린 곳은 F_X 다' if bad >= 3
                      else '통과'))
