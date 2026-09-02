# -*- coding: utf-8 -*-
"""체제 검정 — 2025Q3 의 α 하락이 구성 변화인가 사상 변화인가.

stats-expert 등록 절차:
    2025Q3 전/후로 P(α|z) 를 각각 적합 -> 같은 z 에 대한 예측 비교
      같다   -> 구성 변화.  창을 좁힐 근거가 없다
      다르다 -> 사상 변화.  체제 후 학습(B)이 정당화된다

🔴 이 검정 없이 창을 좁히면 그것도 "결과를 보고 모형을 고치는 것"이다.
   내가 앞서 그 실수를 했고(창 길이를 평가에서 골랐다) 이 절차가 그걸 막는다.

⚠ 평가 기간(2026-01~)은 건드리지 않는다. 학습 기간 안에서만 전/후를 가른다.
    전  2023-09 ~ 2025-06
    후  2025-07 ~ 2025-12

분해 (Oaxaca-Blinder 형):
    Δ = Σ_g [w_post(g) − w_pre(g)]·r_pre(g)      구성 효과 (기관 구성이 바뀜)
      + Σ_g  w_post(g)·[r_post(g) − r_pre(g)]    사상 효과 (기관 안에서 규칙이 바뀜)
"""
from __future__ import annotations

import numpy as np

P = np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz', allow_pickle=True)
A = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
ap = (P['rate'].max(1) - P['rate'].min(1)) / 1.763889
pi = {b: i for i, b in enumerate(P['bid_id'])}
j = np.array([pi.get(b, -1) for b in A['bid_id']])
ok = j >= 0
ah = np.full(len(j), np.nan)
ah[ok] = ap[j[ok]]
ym, purr = A['ym'].astype(int), A['purr']
g = ok & np.isfinite(ah)
y = (ah < 0.025).astype(float)

pre = g & (ym >= 202309) & (ym <= 202506)
post = g & (ym >= 202507) & (ym <= 202512)
print('전 %d (양성률 %.4f) · 후 %d (양성률 %.4f)   차 %+.4f'
      % (pre.sum(), y[pre].mean(), post.sum(), y[post].mean(),
         y[post].mean() - y[pre].mean()))

keys = np.unique(purr[pre | post])
r_pre, r_post, w_pre, w_post, n_pre, n_post = {}, {}, {}, {}, {}, {}
for k in keys:
    a, b = pre & (purr == k), post & (purr == k)
    n_pre[k], n_post[k] = a.sum(), b.sum()
    w_pre[k] = n_pre[k] / pre.sum()
    w_post[k] = n_post[k] / post.sum()
    r_pre[k] = y[a].mean() if n_pre[k] else np.nan
    r_post[k] = y[b].mean() if n_post[k] else np.nan

comp = sum((w_post[k] - w_pre[k]) * (r_pre[k] if n_pre[k] else y[pre].mean())
           for k in keys)
beh = sum(w_post[k] * ((r_post[k] if n_post[k] else 0) -
                       (r_pre[k] if n_pre[k] else y[pre].mean()))
          for k in keys)
tot = y[post].mean() - y[pre].mean()
print('\n=== 분해 ===')
print('  전체 변화   %+.4f' % tot)
print('  구성 효과   %+.4f  (%.1f%%)  기관 구성이 바뀜' % (comp, 100 * comp / tot))
print('  사상 효과   %+.4f  (%.1f%%)  기관 안에서 규칙이 바뀜' % (beh, 100 * beh / tot))

MINN = int(__import__("os").environ.get("MINN", 20))
both = [k for k in keys if n_pre[k] >= MINN and n_post[k] >= MINN]
rp = np.array([r_pre[k] for k in both])
rq = np.array([r_post[k] for k in both])
n_p = np.array([n_pre[k] for k in both], float)
n_q = np.array([n_post[k] for k in both], float)
print('\n=== 같은 z(기관) 에서 예측이 같은가 — 양쪽 n>=50 인 기관 %d 개 ===' % len(both))
print('  상관 %.4f' % np.corrcoef(rp, rq)[0, 1])
d = rq - rp
se = np.sqrt(rp * (1 - rp) / n_p + rq * (1 - rq) / n_q)
z = d / np.maximum(se, 1e-9)
print('  기관별 변화 평균 %+.4f  (가중 %+.4f)'
      % (d.mean(), (d * n_q).sum() / n_q.sum()))
print('  |z| > 2 인 기관 %d / %d  (%.1f%%)   그중 하락 %d'
      % ((abs(z) > 2).sum(), len(both), 100 * (abs(z) > 2).mean(),
         ((z < -2)).sum()))
w = 1 / np.maximum(se, 1e-9) ** 2
zz = (d * w).sum() / np.sqrt(w.sum())
print('  🔴 통합 z (기관별 변화의 역분산 가중) = %+.2f' % zz)
print('\n  판정: %s'
      % ('사상 변화 — 체제 후 학습(B) 정당화됨' if abs(zz) > 3
         else '구성 변화 — 창을 좁힐 근거가 없다'))
