# -*- coding: utf-8 -*-
"""M1 — 구조 모형.

    낙찰 ⟺ x ≥ R  그리고  R ≤ x_j < x 인 경쟁자 j 가 없다

    P(win | x, N, z) = ∫_{r≤x} f_R(r) · (1 − F_X(x) + F_X(r))^N dr

미지수는 F_X 하나다. R 은 파라미터 0개(fr.py), N 은 as-of 관측.

층화 (team-lead 확정):
    1차  N        (N≤2 는 분리 — SBC·T1 층·순열 귀무 세 곳에서 같은 제외가 걸린다)
    2차  기초금액  (N≤29 에서만. N=100+ 에서는 해롭다)

🔴 실패 판정: 보정 곡선이 대각선에서 크게 벗어나면 — R 이 확정이므로 틀린 곳은 F_X 다.
"""
from __future__ import annotations

import numpy as np

from fr import FR, alpha_of

N_EDGES = [3, 5, 10, 30, 100]          # N≤2 / 3-4 / 5-9 / 10-29 / 30-99 / 100+
N_LABELS = ['N<=2', 'N=3-4', 'N=5-9', 'N=10-29', 'N=30-99', 'N=100+']


def n_bucket(n):
    return np.digitize(np.asarray(n), N_EDGES)


def strata(n, base_price, base_q=None):
    """1차 N · 2차 기초금액(N≤29 에서만)."""
    nb = n_bucket(n)
    if base_q is None:
        return nb
    bq = np.where(nb <= 3, base_q, 0)   # N≤29 (버킷 0..3) 에서만 기초금액을 쓴다
    return nb * 10 + bq


class FX:
    """경쟁자 투찰 x 의 층별 경험 CDF.

    ⚠ 학습 자료가 007 조건부다. F_X 는 그 조건 아래의 분포이고,
      무조건부 F_X 는 이 데이터로 식별되지 않는다(개정 17).
      **그래서 M1 의 예측은 "낙찰된 회차 안에서의 상대 비교"로만 읽는다.**
    """

    def __init__(self, x, stratum, grid):
        self.grid = np.asarray(grid, float)
        self.cdf = {}
        for s in np.unique(stratum):
            v = np.sort(x[stratum == s])
            self.cdf[s] = np.searchsorted(v, self.grid, side='right') / len(v)
        self.default = np.mean(list(self.cdf.values()), axis=0)

    def __call__(self, s):
        return self.cdf.get(s, self.default)


class M1:
    def __init__(self, fr: FR | None = None):
        self.fr = fr or FR()
        self.fx: FX | None = None

    def fit(self, x, stratum, xgrid):
        self.xgrid = np.asarray(xgrid, float)
        self.fx = FX(x, stratum, self.xgrid)
        return self

    def win_prob(self, x, n, stratum, alpha):
        """P(낙찰 | x, N, 층, α).  x 는 스칼라 또는 배열.

        🔴 `n` 은 그 회차의 **투찰자 수**(nbid)다. 지수는 `n−1` (경쟁자 수).
           2026-09-02 이전에는 지수에 `n` 을 그대로 썼다 = 경쟁자를 한 명 더 센 것.
           상대 과대계상이 1/(n−1) 이라 저N 에서만 크게 나타났고, 그게
           −20.3%(N=3-4) → −0.9%(N=60-99) 의 단조 미보정 전부였다.
           ⚠ 정의를 여기 한 곳에 가둔다. 호출자는 언제나 투찰자 수를 넘긴다.
        """
        x = np.atleast_1d(np.asarray(x, float))
        ncomp = max(int(n) - 1, 0)
        out = np.empty(len(x))
        Fx_all = self.fx(stratum)
        for i, xi in enumerate(x):
            e = self.fr.edges[alpha]
            mid = self.fr.mid[alpha]
            w = self.fr.pdf[alpha] * np.diff(e)          # P(R in bin)
            use = mid <= xi
            if not use.any():
                out[i] = 0.0
                continue
            F_r = np.interp(mid[use], self.xgrid, Fx_all)
            F_x = np.interp(xi, self.xgrid, Fx_all)
            out[i] = (w[use] * np.clip(1.0 - F_x + F_r, 0, 1) ** ncomp).sum()
        return out

    def best_x(self, n, stratum, alpha, grid=None):
        g = self.xgrid if grid is None else np.asarray(grid, float)
        p = self.win_prob(g, n, stratum, alpha)
        return g[int(np.argmax(p))], p.max()


def _draw_R(fr, alpha, n, rng):
    u = rng.random(n)
    return np.interp(u, fr.cdf[alpha], fr.edges[alpha])


def _competitors(n, size, rng):
    """🔴 경쟁자 분포는 반드시 결정 구간과 겹쳐야 한다.

    첫 판에서 1 + Gamma 를 썼는데 그러면 경쟁자가 **절대 1.0 아래로 안 간다** —
    최적 x=1.0 에서 경쟁자 항이 항상 1 이 되어 승률이 N 과 무관한 상수(0.55)가 됐다.
    **경쟁자 항을 전혀 검사하지 않는 공허한 시험이었다**(팀 실패 목록의 '공허참'과 같은 형태).
    실측처럼 43% 가 커트라인 아래에 오도록 양쪽으로 퍼진 분포를 쓴다.
    """
    return rng.normal(1.0005, 0.006, size)


if __name__ == '__main__':
    rng = np.random.default_rng(0)
    fr = FR(n=200000, seed=1)
    xgrid = np.linspace(0.96, 1.05, 1801)
    comp = _competitors(0, 600000, rng)
    m = M1(fr).fit(comp, np.zeros(len(comp), int), xgrid)

    print('=== L1: 합성 진실 대조 (α=0.03) ===')
    print('  경쟁자 ~ N(1.0005, 0.006)   커트라인 아래 비율 %.3f'
          % (comp < 0.999).mean())
    print('%-7s %10s %10s %9s %9s %8s'
          % ('N', 'M1 최적x', '진실 최적x', 'M1 승률', '진실 승률', '상대오차'))
    R = _draw_R(fr, 0.03, 40000, rng)
    grid = np.linspace(0.985, 1.020, 141)
    # 🔴 N 은 **회차 투찰자 수**다. 초점 투찰자 1명 + 경쟁자 N−1 명.
    #    예전 L1 은 "초점 + 경쟁자 n 명"으로 진실을 만들고 지수에도 n 을 써서
    #    양쪽이 같은 정의를 공유했다 ⟹ 정의 불일치를 **기각할 수 없는** 검정이었다.
    #    실데이터의 n 은 nbid(투찰자 수)였으므로 한 명 더 센 채로 통과했다.
    for n in (3, 5, 10, 30, 100):
        p_m1 = m.win_prob(grid, n, 0, 0.03)
        bx = grid[int(np.argmax(p_m1))]
        cj = _competitors(n, (len(R), n - 1), rng)
        p_true = np.array([((xi >= R) & ~((cj >= R[:, None]) & (cj < xi)).any(1)).mean()
                           for xi in grid])
        bt = grid[int(np.argmax(p_true))]
        i = int(np.argmax(p_true))
        print('%-7d %10.4f %10.4f %9.4f %9.4f %8.3f'
              % (n, bx, bt, p_m1[i], p_true[i], p_m1[i] / max(p_true[i], 1e-9) - 1))
    print()
    print('  판정: 최적 x 가 같고 승률 상대오차가 작으면 M1 구현이 맞다.')
    print('        틀리면 R 은 확정이므로 F_X 쪽 또는 적분 구현이다.')
