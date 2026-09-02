# -*- coding: utf-8 -*-
"""대결 백테스트 `L1` — 그 사람 자리에 우리가 넣었으면 이겼나.

```
모델 낙찰 ⟺ x_model ≥ R  AND  **그 사람을 뺀** 나머지 중 [R, x_model) 에 아무도 없다
          ⟺ R ≤ x_model ≤ m₋ᵢ      m₋ᵢ = min{x_j : x_j ≥ R, j ≠ i}
```
🔴 밀봉 입찰이라 남들 투찰이 고정이다 ⟹ **반사실이 산술이다.** `f_R`·`F_X` 안 쓴다.

🔴 결정과 채점을 코드에서 가른다 (`PREREG_headtohead.md` §C):
```
decide()  마감 전 관측만 — BID_CNT(N_pool)·품목·지역·기초금액·하한율
score()   실현 R·실현 경쟁자 벡터.  산술
```
⚠ 이 파일의 수치는 **`TUNE`** 이다. 판정이 아니라 **검정력 계산용 불일치율**을 얻는 게 목적이다.
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K

H = 0.02


# ---------------------------------------------------------------- decide
def decide(n_pool, alpha2, lam=1.0, grid=None):
    """🔴 마감 전 관측만 쓴다. 실현 R·경쟁자 벡터에 **접근 자체가 없다**.

    정책 족: λ 가 공격성.  λ=1 이면 승률 최대 x, λ<1 이면 그보다 낮게(싸게) 넣는다.
    ⚠ 단일 정책으로 낙찰 수만 비교하면 목적함수 차이가 결과를 만든다 (PREREG §B).
      그래서 λ 를 훑어 **프론티어**로 낸다.
    """
    g = np.linspace(0.96, 1.05, 901) if grid is None else grid
    uq = np.unique(n_pool)
    F = K.Fx_at(uq, H)
    best = {}
    for j, n in enumerate(uq):
        for a2 in (0, 1):
            p = K.pwin_v(g, F[j], np.full(len(g), n, float),
                         a2=np.full(len(g), bool(a2)))
            best[(int(n), a2)] = g[int(np.argmax(p))]
    xstar = np.array([best[(int(n), int(a))] for n, a in zip(n_pool, alpha2)])
    return 1.0 + lam * (xstar - 1.0)


# ---------------------------------------------------------------- score
def score(mask):
    """그 사람을 빼고 우리가 넣었을 때의 낙찰 여부. 실현 R·경쟁자 벡터."""
    sel = mask[K.aid]
    idx = np.flatnonzero(sel)
    ai = K.aid[idx]
    xi = K.x[idx]
    Ra = K.R[ai]

    # 회차별 유효 투찰(x ≥ R)의 최소·차소 — 자기 자신을 뺀 최소를 얻으려면 둘이 필요하다
    valid = K.x >= K.R[K.aid]
    big = np.where(valid, K.x, np.inf)
    o = np.lexsort((big, K.aid))
    xs, as_ = big[o], K.aid[o]
    first = np.ones(len(xs), bool)
    first[1:] = as_[1:] != as_[:-1]
    m1 = np.full(len(K.nbid), np.inf)
    m1[as_[first]] = xs[first]
    second = np.zeros(len(xs), bool)
    second[1:] = first[:-1] & (as_[1:] == as_[:-1])
    m2 = np.full(len(K.nbid), np.inf)
    m2[as_[second]] = xs[second]

    is_min = valid[idx] & (xi <= m1[ai])       # 내가 그 최소인가
    m_excl = np.where(is_min, m2[ai], m1[ai])  # 나를 뺀 최소 유효 투찰
    return idx, ai, xi, Ra, m_excl


def run(mask, lams=(0.4, 0.6, 0.8, 1.0)):
    idx, ai, xi, Ra, m_excl = score(mask)
    act = K.ACT_ALL[idx]
    npool = K.nbid[ai]
    a2 = K.ALPHA2[ai].astype(int)
    print('평가 투찰 %d · 회차 %d' % (len(idx), mask.sum()))
    print('사람   평균 x %.5f · 낙찰률 %.5f' % (xi.mean(), act.mean()))
    print()
    print('%-6s %10s %10s %8s %8s %10s %12s'
          % ('λ', '평균 x', '낙찰률', 'b', 'c', '불일치율', 'b/(b+c)'))
    out = []
    for lam in lams:
        xm = decide(npool, a2, lam)
        win = (xm >= Ra) & (xm <= m_excl)
        b = int((win & (act == 0)).sum())
        c = int(((~win) & (act == 1)).sum())
        disc = (b + c) / len(idx)
        r = b / max(b + c, 1)
        print('%-6.2f %10.5f %10.5f %8d %8d %9.4f%% %11.4f'
              % (lam, xm.mean(), win.mean(), b, c, 100 * disc, r))
        out.append((lam, xm.mean(), win.mean(), b, c, disc, r))
    return out


if __name__ == '__main__':
    print('=== L1 대결 — TUNE (판정 아님. 불일치율/검정력 계산용) ===')
    res = run(K.TUNE)
    d = max(r[5] for r in res)
    print()
    print('🔴 최대 불일치율 %.4f%%  ⟹ McNemar 60:40 탐지에 필요한 회차 ≈ %d'
          % (100 * d, int(194 / max(d, 1e-9))))
    print('⚠ 평균 x 를 반드시 같이 읽어라 — 가격이 다르면 낙찰률 비교가 성립 안 한다')
