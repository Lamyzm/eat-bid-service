# -*- coding: utf-8 -*-
"""후보 2 판정 — `F_X` 의 007 선택편향을 **역확률 가중**으로 되돌린다.

`(a)` 천장이 `f_R`·승률 규칙을 무죄로 만들었다 ⟹ 잔차는 전부 `F_X` 안에 있다.
후보 2 는 그 잔차의 이름이다:

```
코퍼스에 남는 조건 = 낙찰자가 있다 = R ≤ x_max
R 은 입찰과 독립 ⟹ 회차 a 가 관측될 확률 = F_R(x_max_a).  **계산 가능하다**
⟹ 낮게 몰린 회차가 빠진다 ⟹ 관측된 투찰 분포 F_X 가 **위로 치우친다**
⟹ 경쟁자를 실제보다 멀리 본다 ⟹ 승률 **과대**예측.  저N 에서 크다
```

🔴 그래서 되돌릴 수 있다. 회차 가중 `w_a = 1 / F_R(x_max_a)` 로 `F_X` 를 다시 추정한다.
   이건 모형 가정이 아니라 **선택확률이 닫힌 형태로 알려져 있어서** 가능한 것이다.

⚠ 한계: `F_R(x_max)≈0` 인 회차는 아예 관측되지 않아 가중으로 되살릴 수 없다.
   가중 분포를 같이 보고한다. 상한이 아니라 **하한**을 주는 보정이다.
⚠ `TUNE` 평가 · `F_X` 는 학습기 · `R` 은 정의 B · `R_suspect` 제외.
"""
from __future__ import annotations

import numpy as np

import ceiling_a as C
import fx_kernel as K

H = 0.02

# --- 회차별 관측확률 F_R(x_max) -------------------------------------------------
xmax = np.zeros(len(K.R))
np.maximum.at(xmax, K.aid, K.x)
FRX = np.where(K.ALPHA2, C._cdf(0.02, xmax), C._cdf(0.03, xmax))
W = 1.0 / np.clip(FRX, 1e-3, None)
print('관측확률 F_R(x_max)  중앙 %.5f · p1 %.5f · min %.5f'
      % (np.median(FRX[K.TRAIN]), np.percentile(FRX[K.TRAIN], 1), FRX[K.TRAIN].min()))
print('가중 w=1/F_R  중앙 %.4f · p99 %.4f · max %.4f · 유효표본비 %.4f'
      % (np.median(W[K.TRAIN]), np.percentile(W[K.TRAIN], 99), W[K.TRAIN].max(),
         W[K.TRAIN].sum() ** 2 / (len(W[K.TRAIN]) * (W[K.TRAIN] ** 2).sum())))


def emp_cdf(weighted):
    """N 별 경험 CDF. weighted 면 회차 가중 1/F_R(x_max)."""
    tb = K.TRAIN[K.aid]
    wb = W[K.aid] if weighted else np.ones(len(K.x))
    emp, cn = {}, {}
    for n in np.unique(K.nbid[K.TRAIN]):
        q = tb & (K.nbid[K.aid] == n)
        if q.sum() < 50:
            continue
        v, ww = K.x[q], wb[q]
        o = np.argsort(v)
        cw = np.cumsum(ww[o])
        emp[int(n)] = np.interp(K.XGRID, v[o], cw / cw[-1], left=0.0, right=1.0)
        cn[int(n)] = float(q.sum())
    ns = np.array(sorted(emp), float)
    return ns, np.stack([emp[int(n)] for n in ns]), np.array([cn[int(n)] for n in ns])


def run(ns, em, cn, label):
    d = np.abs(np.log(K.UNQ.astype(float))[:, None] - np.log(ns)[None, :])
    w = cn[None, :] * np.exp(-d / H)
    w /= w.sum(1, keepdims=True)
    F = w @ em
    out = np.zeros(len(K.XI))
    for j, n in enumerate(K.UNQ):
        q = K.GRP[int(n)]
        out[q] = K.pwin_v(K.XI[q], F[j], K.NT[q], a2=K.ALPHA2[K.AI][q])
    return out, label


if __name__ == '__main__':
    # 🔴 XI/AI/NT/ACT/UNQ/GRP 는 fx_kernel 이 이미 만든다. 여기서 다시 안 만든다 (규율 30)
    pa, act, aid, nt, xs, _ = C.compute(K.TUNE)
    base = {}
    for lo, hi in K.BANDS:
        q = (nt >= lo) & (nt <= hi)
        base[(lo, hi)] = 100 * (pa[q].mean() / act[q].mean() - 1)
    base['all'] = 100 * (pa.mean() / act.mean() - 1)

    res = []
    for wtd, lab in ((False, '기존 F_X (007 그대로)'), (True, '🔴 IPW F_X (007 되돌림)')):
        p, _ = run(*emp_cdf(wtd), lab)
        res.append((lab, p))

    print('\n=== 후보 2 판정 — 007 기준선 대비 격차가 줄어드나 ===')
    print('%-9s %9s %11s %13s %13s' % ('N', '회차', '007 기준선', '기존 격차', 'IPW 격차'))
    for lo, hi in K.BANDS:
        q = (K.NT >= lo) & (K.NT <= hi)
        if q.sum() < 500:
            continue
        b = base[(lo, hi)]
        g = [100 * (p[q].mean() / K.ACT[q].mean() - 1) - b for _, p in res]
        se = 100 * K.cluster_se(res[1][1][q] - K.ACT[q], K.AI[q]) / K.ACT[q].mean()
        print('%-9s %9d %10.2f%% %+11.2f%%p %+9.2f±%.2f%%p'
              % ('%d-%d' % (lo, hi), len(np.unique(K.AI[q])), b, g[0], g[1], se))
    g = [100 * (p.mean() / K.ACT.mean() - 1) - base['all'] for _, p in res]
    print('%-9s %9d %10.2f%% %+11.2f%%p %+11.2f%%p'
          % ('전체', K.TUNE.sum(), base['all'], g[0], g[1]))
    print('\n  🔴 IPW 격차가 0 으로 가면 후보 2 가 원인이다.')
    print('     안 줄면 F_X 안의 다른 것이다 (형태·층·회차 내 의존).')
