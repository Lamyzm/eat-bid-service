# -*- coding: utf-8 -*-
"""`F_X` 안에 남은 것 — **iid 가정**인가.  회차 벡터를 통째로 재표집해서 가른다.

`(a)` 가 `f_R`·규칙을 무죄로 만들었고 IPW 가 후보 2 를 26% 로 재었다.
저`N` 에 `+6.5 %p` 가 남는다. `F_X` 안의 무엇인가.

**남은 후보를 가르는 방법 — 새 모형 없이:**
```
iid 예측    경쟁자 N−1 명을 F_X(·|N) 에서 **독립**으로       ← 지금 모형
회차 예측   같은 N 의 **다른 회차 벡터**를 통째로 빌려온다   ← 회차 내 결합구조 보존

둘 다 R 은 f_R 로 해석적 주변화.  둘 다 같은 닫힌 형태:
    P(승_i | 경쟁자 벡터 c) = F_R(x_i) − F_R(max{c_j : c_j < x_i})
```
🔴 **주변분포는 같고 결합구조만 다르다.** 회차 예측이 보정되고 iid 가 과대예측하면
   남은 것은 **iid 가정**이다. 둘 다 과대예측하면 `F_X` 의 *주변분포* 자체가 틀린 것이다.

⚠ 공여 회차는 학습기에서, IPW 가중으로 뽑는다 (007 를 다시 넣지 않으려고).
⚠ 저`N` 만 본다 — 격차가 거기 있고 고`N` 은 공여 행렬이 너무 크다.
"""
from __future__ import annotations

import numpy as np

import ceiling_a as C
import fx_kernel as K
from cand2_ipw import W, emp_cdf

NMAX = 29
NDON = 64
rng = np.random.default_rng(7)

# --- 공여 풀: 학습기 회차를 N 별로 (N × 투찰) 행렬로 -------------------------------
don, donw = {}, {}
for n in range(3, NMAX + 1):
    a = np.flatnonzero(K.TRAIN & (K.nbid == n))
    if len(a) < 200:
        continue
    st = np.concatenate([[0], np.cumsum(K.cnt)[:-1]])[a]
    don[n] = K.x[(st[:, None] + np.arange(n)[None, :])]
    p = W[a]
    donw[n] = p / p.sum()
print('공여 풀 N=%d~%d · 회차 수 %s'
      % (min(don), max(don), {k: len(v) for k, v in list(don.items())[:4]}))


def p_align(xi, n, a2):
    """🔴 공여 회차를 **내 x 에 맞춰 정렬**한다.

    회차 재표집(위)은 경쟁자끼리의 상관만 넣고 *나와 경쟁자* 상관은 안 넣는다.
    실제로는 내 x 도 그 회차 수준을 타고 있다. 공여 회차에서 한 명을 '나' 로 삼아
    그 사람이 x_i 가 되도록 벡터 전체를 평행이동하면 두 상관이 다 들어간다.
    (교환가능 위치족 가정.  회차 수준을 조건화한 것과 같다)
    """
    D, w = don[n], donw[n]
    out = np.zeros(len(xi))
    for _ in range(NDON):
        j = rng.choice(len(D), len(xi), p=w)
        c = D[j]
        me = rng.integers(0, n, len(xi))
        shift = xi - c[np.arange(len(xi)), me]
        keep = np.arange(n)[None, :] != me[:, None]
        c = c[keep].reshape(len(xi), n - 1) + shift[:, None]
        lo = np.where(c < xi[:, None], c, -np.inf).max(1)
        out += np.where(a2, C._cdf(0.02, xi) - C._cdf(0.02, lo),
                        C._cdf(0.03, xi) - C._cdf(0.03, lo))
    return np.clip(out / NDON, 0, 1)


def p_round(xi, n, a2):
    """회차 벡터를 통째로 빌려온 예측. 공여 회차에서 한 명을 빼 N−1 명으로."""
    D, w = don[n], donw[n]
    out = np.zeros(len(xi))
    for _ in range(NDON):
        j = rng.choice(len(D), len(xi), p=w)
        c = D[j]                                     # (b, n)
        drop = rng.integers(0, n, len(xi))
        keep = np.arange(n)[None, :] != drop[:, None]
        c = c[keep].reshape(len(xi), n - 1)
        lo = np.where(c < xi[:, None], c, -np.inf).max(1)
        out += np.where(a2, C._cdf(0.02, xi) - C._cdf(0.02, lo),
                        C._cdf(0.03, xi) - C._cdf(0.03, lo))
    return np.clip(out / NDON, 0, 1)


if __name__ == '__main__':
    sel = K.TUNE[K.aid] & (K.nbid[K.aid] <= NMAX)
    XI, AI = K.x[sel], K.aid[sel]
    NT = K.nbid[AI]
    A2 = K.ALPHA2[AI]
    v = K.x >= K.R[K.aid]
    xv = np.where(v, K.x, 1e9)
    o = np.lexsort((xv, K.aid))
    f = np.ones(len(K.x), bool)
    f[1:] = K.aid[o][1:] != K.aid[o][:-1]
    w_ = np.zeros(len(K.x), bool)
    wi = o[f]
    w_[wi] = v[wi]
    ACT = w_[sel].astype(float)
    print('평가 투찰 %d (N<=%d) · 실제 낙찰률 %.5f' % (len(XI), NMAX, ACT.mean()))

    # iid 예측 (IPW F_X)
    ns, em, cn = emp_cdf(True)
    UNQ = np.unique(NT)
    d = np.abs(np.log(UNQ.astype(float))[:, None] - np.log(ns)[None, :])
    ww = cn[None, :] * np.exp(-d / 0.02)
    ww /= ww.sum(1, keepdims=True)
    F = ww @ em
    P_IID = np.zeros(len(XI))
    P_RND = np.zeros(len(XI))
    P_ALN = np.zeros(len(XI))
    for j, n in enumerate(UNQ):
        q = np.flatnonzero(NT == n)
        P_IID[q] = K.pwin_v(XI[q], F[j], NT[q], a2=A2[q])
        if int(n) in don:
            P_RND[q] = p_round(XI[q], int(n), A2[q])
            P_ALN[q] = p_align(XI[q], int(n), A2[q])
        else:
            P_RND[q] = P_ALN[q] = np.nan

    pa, act_a, aid_a, nt_a, _, _ = C.compute(K.TUNE)
    print('\n=== 결합구조만 바꾼다 — 007 기준선 대비 격차 ===')
    print('%-9s %9s %10s %12s %14s %14s'
          % ('N', '회차', '007 기준선', 'iid (IPW)', '회차 재표집', '🔴 정렬 재표집'))
    for lo, hi in [(3, 4), (5, 9), (10, 29)]:
        q = (NT >= lo) & (NT <= hi)
        qa = (nt_a >= lo) & (nt_a <= hi)
        b = 100 * (pa[qa].mean() / act_a[qa].mean() - 1)
        g1 = 100 * (P_IID[q].mean() / ACT[q].mean() - 1) - b
        g2 = 100 * (P_RND[q].mean() / ACT[q].mean() - 1) - b
        s1 = 100 * K.cluster_se(P_IID[q] - ACT[q], AI[q]) / ACT[q].mean()
        s2 = 100 * K.cluster_se(P_RND[q] - ACT[q], AI[q]) / ACT[q].mean()
        g3 = 100 * (P_ALN[q].mean() / ACT[q].mean() - 1) - b
        s3 = 100 * K.cluster_se(P_ALN[q] - ACT[q], AI[q]) / ACT[q].mean()
        print('%-9s %9d %9.2f%% %+7.2f±%.2f%%p %+8.2f±%.2f%%p %+8.2f±%.2f%%p'
              % ('%d-%d' % (lo, hi), len(np.unique(AI[q])), b, g1, s1, g2, s2, g3, s3))
    print('\n  🔴 회차 재표집이 0 으로 가면 남은 것은 **iid 가정**이다.')
    print('     둘 다 남으면 F_X 의 주변분포 자체가 틀렸다.')
