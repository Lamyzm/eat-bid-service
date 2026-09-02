# -*- coding: utf-8 -*-
"""f_R — 커트라인 비율의 분포. 파라미터 0개, α 하나짜리 모수족.

메커니즘이 확정됐으므로(2026-09-02-mechanism-verdict.md) R 은 추정 대상이 아니다:

    후보 15개   아래 8 ~ U(1-α, 1)   ·   위 7 ~ U(1, 1+α)
    R           그중 4개의 평균                (선택이 가격과 독립임을 판정했다)

    ⟹ R ~ "8/7 층화 모집단에서 4개 비복원 추출의 평균"

α 규칙 (team-lead 확정):  하한율 88 & 기초금액 < 2,000만  →  0.02
                          그 외                          →  0.03

🔴 리샘플 금지. α 격자에 미리 계산해 둔다 — M1 이 회차마다 이걸 부르기 때문이다.

검산 (α=0.03):
    E[R] − 1   = (8·(1−α/2) + 7·(1+α/2))/15 − 1 = −α/30 = −10.0 bp
    sd(R)                                        ≈ 0.00760   (실측 0.007605)
"""
from __future__ import annotations

import numpy as np

GRID = np.array([0.02, 0.03])          # 지금 규칙이 내는 값 둘. 넓히면 여기에 추가한다


def alpha_of(floor_rate, base_price):
    """α 규칙. floor_rate 는 하한율(88/90 등), base_price 는 기초금액(원)."""
    f = np.asarray(floor_rate, dtype=float)
    b = np.asarray(base_price, dtype=float)
    return np.where((f == 88) & (b < 2e7), 0.02, 0.03)


def _sample_R(alpha, n, rng):
    lo = rng.uniform(1 - alpha, 1.0, (n, 8))
    hi = rng.uniform(1.0, 1 + alpha, (n, 7))
    v = np.concatenate([lo, hi], axis=1)
    # 4개 비복원 추출 — 선택이 가격과 독립이므로 균등 추출과 같다(§0-F 판정)
    idx = np.argsort(rng.random((n, 15)), axis=1)[:, :4]
    return np.take_along_axis(v, idx, axis=1).mean(1)


class FR:
    """α 격자에 대해 R 의 경험 CDF/PDF 를 미리 계산해 둔다."""

    def __init__(self, grid=GRID, n=400000, seed=0, nbin=2001):
        rng = np.random.default_rng(seed)
        self.grid = np.asarray(grid, float)
        self.edges, self.cdf, self.pdf, self.mid = {}, {}, {}, {}
        for a in self.grid:
            r = _sample_R(a, n, rng)
            lo, hi = 1 - a, 1 + a
            e = np.linspace(lo, hi, nbin)
            h, _ = np.histogram(r, bins=e)
            p = h / h.sum() / np.diff(e)
            self.edges[a] = e
            self.mid[a] = 0.5 * (e[:-1] + e[1:])
            self.pdf[a] = p
            self.cdf[a] = np.concatenate([[0.0], np.cumsum(h) / h.sum()])

    def moments(self, a):
        m = self.mid[a]
        w = self.pdf[a] * np.diff(self.edges[a])
        mu = (m * w).sum()
        return mu, np.sqrt((w * (m - mu) ** 2).sum())

    def cdf_at(self, a, x):
        """P(R <= x)."""
        return np.interp(x, self.edges[a], self.cdf[a], left=0.0, right=1.0)


if __name__ == '__main__':
    fr = FR()
    print('=== f_R 검산 — 해석적 예측과 대조 ===')
    for a in fr.grid:
        mu, sd = fr.moments(a)
        print('  α=%.3f   E[R]−1 = %+8.3f bp (해석 %+.3f)   sd(R) = %.6f'
              % (a, (mu - 1) * 1e4, -a / 30 * 1e4, sd))
    print()
    print('  실측(전수 233,155):  E[R]−1 = −11.33 bp (007 조건부) · −10.0 (무조건부 앵커)')
    print('                       sd(R)  = 0.007605')
    print()
    print('  🔴 α=0.03 이 무조건부 앵커와 맞아야 한다. 007 조건부(−11.33)와 맞으면 안 된다 —')
    print('     f_R 은 생성 과정이고 007 은 관측 필터다 (§0-I).')
