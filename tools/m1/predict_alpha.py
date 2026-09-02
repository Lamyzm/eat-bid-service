# -*- coding: utf-8 -*-
"""모듈 책임: α 예측 — 규칙(재현율 24%)을 as-of 변수로 대체할 수 있나.

문제(개정 18): α̂ < 0.025 인 회차가 11.3% 인데 team-lead 의 규칙
(하한율 88 & 기초금액 < 2,000만 → 0.02)은 그중 24.3% 만 잡는다.
f_R 은 M1 의 눈금 전체라 회차의 8.5% 에서 커트라인 불확실성을 최대 50% 과대평가한다.

    목표    1{α̂ < 0.025}   ← 이진. 우리가 필요한 건 "낮은 밴드인가"이지 α 값이 아니다
            α̂ 연속값도 같이 (보조)
    인자    as-of 안전한 것만: ym · floor · bgng · purr(발주기관) · item · N(as-of)
    분할    학습 ~2025-12 / 평가 2026-01~   ← α̂ 는 개찰 후 관측이라 학습에만 쓴다
    지표    재현율 (지금 문제가 정확히 재현율이다) + 정밀도

⚠ N(as-of) 은 T−1h 값을 써야 하지만 여기서는 최종 nbid 를 쓴다 —
  α 는 후보 생성 시점에 정해지므로 N 과 인과적으로 무관해야 하고,
  N 이 예측에 기여하면 그게 오히려 이상 신호다. 진단용으로 넣는다.
"""
from __future__ import annotations

import numpy as np

# 🔴 봉인 경계 (2026-09-02 팀리드 확정): TUNE = 202601~202605.  202606~ 는 HOLD_A/HOLD_B.
#    이 스크립트는 봉인 이전에 작성돼 평가창이 `ym >= 202601` 이었다 = 봉인을 넘는다.
#    창을 TUNE 으로 좁힌다.  넓히려면 팀리드 서면 승인이 필요하다.
_SEAL_MAX = 202605

P = np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz', allow_pickle=True)
A = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)

# --- α̂ : 후보 범위에서 추정.  E[max-min] = α(8/9 + 7/8) = 1.763889 α
ahat_p = (P['rate'].max(1) - P['rate'].min(1)) / 1.763889
pidx = {b: i for i, b in enumerate(P['bid_id'])}
j = np.array([pidx.get(b, -1) for b in A['bid_id']])
ok = j >= 0
ahat = np.full(len(j), np.nan)
ahat[ok] = ahat_p[j[ok]]

ym = A['ym'].astype(int)
floor = A['floor']
bgng = A['bgng']
purr = A['purr']
item = A['item'].astype(int)
nbid = A['nbid'].astype(int)

good = ok & np.isfinite(ahat) & (bgng > 0)
y = (ahat < 0.025).astype(int)
train = good & (ym <= 202512)
test = good & (ym >= 202601) & (ym <= _SEAL_MAX)
print('학습 %d · 평가 %d   (평가 양성률 %.4f)' % (train.sum(), test.sum(), y[test].mean()))

RULE = (floor == 88) & (bgng < 2e7)


def score(name, pred, sel=test):
    tp = (pred & (y == 1) & sel).sum()
    fp = (pred & (y == 0) & sel).sum()
    fn = ((~pred) & (y == 1) & sel).sum()
    prec = tp / max(tp + fp, 1)
    rec = tp / max(tp + fn, 1)
    print('  %-34s 정밀도 %.4f  재현율 %.4f  F1 %.4f  (양성예측 %d)'
          % (name, prec, rec, 2 * prec * rec / max(prec + rec, 1e-9), tp + fp))
    return rec


print('\n=== 기준선 ===')
score('현행 규칙 (하한88 & <2,000만)', RULE)

# --- 발주기관별 과거 양성률 (학습 기간에서만) ---
def group_rate(key, min_n=30):
    tab, glob = {}, y[train].mean()
    for k in np.unique(key[train]):
        m = train & (key == k)
        if m.sum() >= min_n:
            tab[k] = y[m].mean()
    return tab, glob


print('\n=== 1단계: 있는 필드만 ===')
for lbl, key in [('발주기관(purr)', purr), ('품목(item)', item.astype(str)),
                 ('하한율(floor)', floor.astype(str))]:
    tab, glob = group_rate(key)
    p = np.array([tab.get(k, glob) for k in key])
    print('  --- %s  (그룹 %d, 전역 양성률 %.4f)' % (lbl, len(tab), glob))
    for thr in (0.5, 0.3):
        score('    과거 양성률 > %.1f' % thr, p > thr)

# --- 조합: 발주기관 + 하한율 + 기초금액 구간 ---
print('\n=== 2단계: 조합 키 ===')
bq = np.digitize(bgng, np.percentile(bgng[train], [20, 40, 60, 80]))
combo = np.char.add(np.char.add(purr, floor.astype(int).astype(str)), bq.astype(str))
tab, glob = group_rate(combo, min_n=20)
p = np.array([tab.get(k, glob) for k in combo])
print('  발주기관 × 하한율 × 기초금액5분위  (그룹 %d)' % len(tab))
for thr in (0.7, 0.5, 0.3, 0.15):
    score('    과거 양성률 > %.2f' % thr, p > thr)

print('\n=== 진단: 발주기관 하나로 얼마나 갈리나 ===')
tab, glob = group_rate(purr, min_n=100)
v = np.array(sorted(tab.values()))
print('  기관별 양성률 분위 p10/p50/p90 = %s  (전역 %.4f)'
      % (np.round(np.percentile(v, [10, 50, 90]), 4), glob))
print('  양성률 > 0.5 인 기관 %d / %d' % ((v > 0.5).sum(), len(v)))
