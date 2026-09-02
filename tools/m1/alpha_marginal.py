# -*- coding: utf-8 -*-
"""α 주변화 — P(α|z) 를 축소(M3)로 추정하고 f_R 을 가중합한다.

    f_R(r | z) = P(α=.02|z)·f_R(r|.02) + P(α=.03|z)·f_R(r|.03)

이진화를 안 한다. 이유 넷(개정 19):
  1. 약한 예측을 이진화하면 정보를 버린다
  2. 정밀도/재현율 임계를 고를 필요가 없다
  3. 🔴 비대칭 비용이 자동 처리된다 — α=.03 인데 .02 로 쓰면 과신(나쁨),
     반대는 과소확신(덜 나쁨). 주변화는 애매한 회차를 넓은 쪽으로 민다
  4. 체제 변화(2025Q3)에 절벽이 안 생긴다

P(α|z) 는 발주기관별 경험 베이즈 축소 — 이것이 M3(계층 모형)의 첫 실물 사용이다.

🔴 사전 등록한 예측 (결과 보기 전에 적는다):
    α=0.03 고정판에서 상위 두 십분위가 9~13% 과소예측했다.
    α 가 낮으면 R 이 좁아 최적 x 근처 승률이 높으므로 그 방향이 맞다.
    ⟹ 주변화를 넣으면 상위 두 십분위의 미보정이 줄어야 한다.
    ⟹ 안 줄면 원인은 α 가 아니라 F_X 다.
"""
from __future__ import annotations

import numpy as np

# 🔴 봉인 경계 (2026-09-02 팀리드 확정): TUNE = 202601~202605.  202606~ 는 HOLD_A/HOLD_B.
#    이 스크립트는 봉인 이전에 작성돼 평가창이 `ym >= 202601` 이었다 = 봉인을 넘는다.
#    창을 TUNE 으로 좁힌다.  넓히려면 팀리드 서면 승인이 필요하다.
_SEAL_MAX = 202605


def shrunk_rate(key, y, train, min_prior=1.0):
    """발주기관별 P(α낮음) 를 경험 베이즈로 축소한다 (Beta-Binomial).

    p_g = (k_g + a) / (n_g + a + b),  a,b 는 전역 분포의 적률에서.
    n_g 가 작으면 전역으로 당겨진다 — M3 의 shrinkage 가 바로 이것이다.
    """
    ks, ns = {}, {}
    for k in np.unique(key[train]):
        m = train & (key == k)
        ks[k], ns[k] = int(y[m].sum()), int(m.sum())
    glob = y[train].mean()
    rates = np.array([ks[k] / ns[k] for k in ks if ns[k] >= 5])
    if len(rates) > 10:
        v = max(rates.var(), 1e-6)
        s = max(glob * (1 - glob) / v - 1, min_prior)
    else:
        s = 50.0
    a, b = glob * s, (1 - glob) * s
    out = np.full(len(key), glob)
    for i, k in enumerate(key):
        if k in ns:
            out[i] = (ks[k] + a) / (ns[k] + a + b)
    return out, s, glob


if __name__ == '__main__':
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
    tr, te = g & (ym <= 202512), g & (ym >= 202601) & (ym <= _SEAL_MAX)

    p, s, glob = shrunk_rate(purr, y, tr)
    print('축소 강도 s=%.1f (사전 표본크기)  전역 %.4f' % (s, glob))
    print('학습 양성률 %.4f · 평가 양성률 %.4f' % (y[tr].mean(), y[te].mean()))

    print('\n=== P(α낮음|z) 보정 검사 — 주변화의 새 관문 ===')
    print('  %-16s %8s %8s %8s' % ('예측구간', 'n', '예측', '관측'))
    e = np.unique(np.percentile(p[te], np.arange(0, 101, 20)))
    for i in range(len(e) - 1):
        q = te & (p >= e[i]) & (p < e[i + 1] if i < len(e) - 2 else p <= e[-1])
        if q.sum() < 100:
            continue
        print('  [%.4f,%.4f) %8d %8.4f %8.4f'
              % (e[i], e[i + 1], q.sum(), p[q].mean(), y[q].mean()))
    b = np.mean((p[te] - y[te]) ** 2)
    b0 = np.mean((y[tr].mean() - y[te]) ** 2)
    print('\n  Brier  주변화 %.5f  vs  전역상수 %.5f   개선 %.1f%%'
          % (b, b0, 100 * (1 - b / b0)))
    rule = ((A['floor'] == 88) & (A['bgng'] < 2e7)).astype(float)
    br = np.mean((np.where(rule[te] > 0, 1.0, 0.0) - y[te]) ** 2)
    print('  Brier  현행 규칙(이진) %.5f   → 주변화가 %.1f%% 낫다'
          % (br, 100 * (1 - b / br)))
    np.savez(r'F:/Project/eat-bid/data/mechanism/_p_alpha.npz',
             bid_id=A['bid_id'], p_low=p)
    print('\n  저장: _p_alpha.npz  (bid_id, p_low)')
