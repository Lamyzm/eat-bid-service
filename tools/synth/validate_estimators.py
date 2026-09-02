# -*- coding: utf-8 -*-
"""L1 — 우리가 실데이터에 이미 쓴 추정기 둘을 합성 진실에 대고 검증한다.

SBC 는 사후분포가 필요해서 M1 이 서야 돌릴 수 있다(개정 17). 그 전에
**점추정기의 L1**(§4-2)은 지금 돌릴 수 있고, 사실 진작 돌렸어야 했다 —
아래 둘은 이미 실데이터 판정에 쓰였는데 진실에 대고 검증된 적이 없다.

    추정기 A  안전 부분집합의 mean(D)          -> 진실: 0 이어야 한다
    추정기 B  열거 귀무 E_H0[D|낙찰] 의 잔차   -> 진실: 0 이어야 한다

합성 세계에서는 슬롯<->가격이 **구성상 독립**이므로 콜라이더 말고는
D 를 만들 것이 없다. 그러니 둘 다 0 을 내야 한다. 못 내면 우리가
실데이터에서 읽은 "안전집합 +0.54" 와 "잔차 +0.375" 의 일부는
추정기 자신의 편향이다.
"""
from __future__ import annotations

import itertools

import numpy as np

import generator as G

SUBS = list(itertools.combinations(range(15), 4))
M = np.zeros((len(SUBS), 15))
for _i, _s in enumerate(SUBS):
    M[_i, list(_s)] = 1.0
KEY = {s: i for i, s in enumerate(SUBS)}


def enumeration_null(rate, chosen, xmax, cell):
    """E_H0[D | 낙찰] — 셀별 마스크 경험분포 + 생존제약. 몬테카를로 없음."""
    n = len(rate)
    midx = np.array([KEY[tuple(np.flatnonzero(c))] for c in chosen])
    m = rate.mean(1)
    W = {}
    for c in np.unique(cell):
        w = np.bincount(midx[cell == c], minlength=len(SUBS)).astype(float)
        W[c] = w / w.sum()
    pred = np.full(n, np.nan)
    for a in range(0, n, 4000):
        j = slice(a, min(a + 4000, n))
        Rall = (rate[j] @ M.T) / 4.0
        surv = Rall <= xmax[j][:, None]
        w = np.stack([W[c] for c in cell[j]])
        den = (w * surv).sum(1)
        num = (w * surv * (Rall - m[j][:, None])).sum(1)
        ok = den > 0
        out = np.full(len(den), np.nan)
        out[ok] = num[ok] / den[ok]
        pred[j] = out
    return pred


def main(n=120000, seeds=range(30, 36)):
    """🔴 반드시 여러 시드로 돌린다.

    단일 시드(seed=21)로는 A +0.425 · B +0.341 이 나왔고, 그걸 그대로 읽으면
    "추정기가 편향돼 있고 실데이터 잔차는 인공물"이라는 **틀린 결론**이 된다.
    6 시드 풀링하면 A +0.027 (z=+0.26) · B −0.051 (z=−0.74) 로 둘 다 0 이다.
    한 번의 추출은 추정치가 아니다 — 원칙 0 의 또 다른 형태다.
    """
    accA, accB = [], []
    for seed in seeds:
        a, b = _one(n, seed)
        accA.append(a)
        accB.append(b)
        print('  seed %d  A %+.4f  B %+.4f' % (seed, a.mean(), b.mean()), flush=True)
    A, B = np.concatenate(accA), np.concatenate(accB)
    print('\n=== 합성 진실 = 0.  추정기 편향 (%d seeds 풀링) ===' % len(accA))
    for lbl, v, rv, rs in [('A 안전집합', A, 0.542, 0.176), ('B 열거잔차', B, 0.375, 0.124)]:
        se = v.std(ddof=1) / np.sqrt(len(v))
        d, ds = rv - v.mean(), np.sqrt(rs ** 2 + se ** 2)
        print('  %-10s n=%8d  %+.4f bp (SE %.4f, z=%+5.2f)   실데이터 %+.3f'
              % (lbl, len(v), v.mean(), se, v.mean() / se, rv))
        print('  %-10s 실데이터 − 편향 = %+.4f (SE %.4f, z=%+.2f)  -> %s'
              % ('', d, ds, d / ds,
                 '실제 잔차 있음' if abs(d / ds) > 2 else '구분 안 됨'))


def _one(n, seed):
    s = G.simulate(n, apply_007_filter=True, seed=seed, bid_scale=0.0065)
    rate, chosen, R, mr = s['rate'], s['chosen'], s['R'], s['mean_r']
    xmax, nv = s['xmax'], s['nvoter']
    D = R - mr
    srt = np.sort(rate, axis=1)
    safe = xmax >= srt[:, -4:].mean(1)                      # 추정기 A
    nb = np.digitize(nv, [2, 3, 5, 7, 10, 13, 26, 51, 100])
    pred = enumeration_null(rate, chosen, xmax, nb)         # 추정기 B
    ok = np.isfinite(pred)
    return D[safe] * 1e4, (D[ok] - pred[ok]) * 1e4


if __name__ == '__main__':
    main()
