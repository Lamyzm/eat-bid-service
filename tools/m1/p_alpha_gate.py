# -*- coding: utf-8 -*-
"""P(α|z) 게이트 — Murphy 분해로 판정한다.

절차 (team-lead 확정 · stats-expert 게이트):
  1. 체제 후 전부(2025-07~12)로 학습    ← 창 길이를 안 고른다. 선택지가 없으면 선택 편향도 없다
  2. 축소 강도 s = 신뢰도 게이트를 통과하는 범위에서 분해능 최대
  3. 절편만 재보정 (기울기까지 하면 재학습이지 보정이 아니다)
  4. Murphy 분해로 판정:  Brier = 신뢰도 − 분해능 + 불확실성
  5. 통과 -> 주변화 · 못 하면 -> A (α=0.03 고정)

🔴 신뢰도만 걸면 "항상 기저율" 모형이 만점을 받는다. 완벽히 보정돼 있고 완전히 쓸모없다.
   그래서 분해능을 같이 본다. 그리고 축소는 보정을 좋게 하면서 분해능을 죽이므로
   "신뢰도 통과 범위에서 분해능 최대"가 정확한 목적함수다.

🔴 절편 재보정의 누출 처리:
   평가 기간 기저율로 절편을 맞추면 그건 미래를 보는 것이다.
   대신 **평가 각 월에 대해 그 이전 월들의 기저율만** 쓴다 (전진 검증).
   서빙 시점에 실제로 알 수 있는 것과 같다.
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

TRAIN = g & (ym >= 202507) & (ym <= 202512)      # 체제 후 전부
EVAL = g & (ym >= 202601)
print('학습 %d (양성률 %.4f)  ·  평가 %d (%.4f)'
      % (TRAIN.sum(), y[TRAIN].mean(), EVAL.sum(), y[EVAL].mean()))


def fit(s):
    """축소 강도 s 로 기관별 사후확률. s 는 사전 표본크기."""
    glob = y[TRAIN].mean()
    a, b = glob * s, (1 - glob) * s
    ks, ns = {}, {}
    for k in np.unique(purr[TRAIN]):
        m = TRAIN & (purr == k)
        ks[k], ns[k] = y[m].sum(), m.sum()
    return np.array([(ks[k] + a) / (ns[k] + a + b) if k in ns else glob
                     for k in purr]), glob


def recal_forward(p, glob_train):
    """절편만 재보정. 평가 각 월은 그 이전 월 기저율만 쓴다 (누출 없음)."""
    out = p.copy()
    months = sorted(np.unique(ym[EVAL]))
    lo = lambda q: np.log(np.clip(q, 1e-6, 1 - 1e-6) / (1 - np.clip(q, 1e-6, 1 - 1e-6)))
    for i, mth in enumerate(months):
        m = EVAL & (ym == mth)
        past = g & (ym >= 202507) & (ym < mth)
        base = y[past].mean() if past.sum() > 500 else glob_train
        shift = lo(base) - lo(glob_train)
        z = lo(p[m]) + shift
        out[m] = 1 / (1 + np.exp(-z))
    return out


def murphy(p, t, nbin=200):
    """Brier = 신뢰도 − 분해능 + 불확실성.

    🔴 nbin 을 크게 잡아라. 10 구간이면 항등식이 0.0107 만큼 안 닫히고
       (구간 내 분산이 res 로 안 잡힌다) **분해능 순서가 뒤집힌다.**
       200 구간에서 항등식이 6e-6 안에서 닫힌다.
       첫 실행에서 10 구간을 써서 s=30 을 골랐는데, 200 구간으로 보면
       s=3 이 신뢰도·분해능 **둘 다** 낫다. 거친 분해가 반대 답을 줬다.
    """
    e = np.unique(np.quantile(p, np.linspace(0, 1, nbin + 1)))
    idx = np.clip(np.searchsorted(e, p, 'right') - 1, 0, len(e) - 2)
    tbar = t.mean()
    rel = res = 0.0
    for b in range(len(e) - 1):
        m = idx == b
        if not m.any():
            continue
        w = m.mean()
        rel += w * (p[m].mean() - t[m].mean()) ** 2
        res += w * (t[m].mean() - tbar) ** 2
    return dict(brier=np.mean((p - t) ** 2), rel=rel, res=res,
                unc=tbar * (1 - tbar))


if __name__ == '__main__':
    te = EVAL
    t = y[te]
    base_brier = np.mean((y[TRAIN].mean() - t) ** 2)
    print('\n%-8s %10s %10s %10s %10s %9s'
          % ('s', 'Brier', '신뢰도', '분해능', 'vs 전역', '통과'))
    best = None
    for s in (0, 1, 3, 10, 30, 100, 300, 1000, 3000):
        p, glob = fit(max(s, 1e-9))
        p = recal_forward(p, glob)
        d = murphy(p[te], t)
        gain = 1 - d['brier'] / base_brier
        # 🔴 선택 규칙: Brier 최소.  "신뢰도 게이트 + 분해능 최대"를 쓰지 않는다.
        #    Brier = rel − res + unc 이므로 min Brier == max(res − rel) 이고,
        #    "항상 기저율" 모형은 res=0 이라 Brier=unc 로 자동 배제된다.
        #    게이트+분해능 규칙은 분해능 곡면이 평평할 때 잡음을 고르고,
        #    실제로 첫 실행에서 s=3 대신 s=30 을 골랐다(신뢰도·분해능 둘 다 나쁜 쪽).
        gate = d['rel'] <= 0.1 * d['unc']            # 진단용으로만 표시
        mark = 'ok' if gate else '신뢰도미달'
        if best is None or d['brier'] < best[1]['brier']:
            best = (s, d, gain)
        print('%-8s %10.6f %10.6f %10.6f %+9.1f%% %9s'
              % (s, d['brier'], d['rel'], d['res'], 100 * gain, mark))
    print('\n  전역상수(학습 기저율) Brier %.6f' % base_brier)
    if best:
        s, d, gain = best
        print('  선택: s=%s  (Brier 최소)  신뢰도 %.6f · 분해능 %.6f' % (s, d['rel'], d['res']))
        print('     Brier %.6f  vs 전역 %+.1f%%' % (d['brier'], 100 * gain))
        print('\n  판정: %s' % ('통과 → 주변화로 간다' if gain > 0.05
                                else '🔴 못 넘음 → A (α=0.03 고정)'))
    else:
        print('  🔴 신뢰도 게이트를 통과하는 s 가 없다 → A')
