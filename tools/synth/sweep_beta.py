# -*- coding: utf-8 -*-
"""통과 기준 4 — N 의존 투찰 분포로 실측 D 패턴을 재현할 수 있나.

투찰 산포 s(N) = bid_scale * (N/14)^(-beta) 로 두고 beta 를 쓴다.
beta > 0 이면 "경쟁이 적으면 높게 넣는다".

결과(개정 16): 어떤 beta 로도 안 맞는다. 실측 패턴이 비단조인데
단일 파라미터 N 의존은 단조 패턴만 만든다.
"""
import numpy as np

import generator as G

REAL = {'N<=2': -1.241, 'N=3-4': -4.868, 'N=5-9': -2.371,
        'N=10-29': -2.284, 'N=30-99': -0.933, 'N=100+': -0.709}
BUCKETS = [(1, 2, 'N<=2'), (3, 4, 'N=3-4'), (5, 9, 'N=5-9'),
           (10, 29, 'N=10-29'), (30, 99, 'N=30-99'), (100, 10 ** 9, 'N=100+')]


def pattern(n=150000, seed=7, **kw):
    s = G.simulate(n, apply_007_filter=True, seed=seed, **kw)
    D = (s['R'] - s['mean_r']) * 1e4
    nv = s['nvoter']
    out = {}
    for lo, hi, lab in BUCKETS:
        q = (nv >= lo) & (nv <= hi)
        out[lab] = D[q].mean() if q.sum() > 50 else float('nan')
    return out, D.mean(), s['keep_rate']


if __name__ == '__main__':
    hdr = ' '.join('%7s' % lab for _, _, lab in BUCKETS)
    print('%-8s %7s %7s  %s' % ('beta', '전체', '생존', hdr))
    print('%-8s %7.2f %7s  %s' % ('실측', -2.00, '?',
                                  ' '.join('%7.2f' % REAL[l] for _, _, l in BUCKETS)))
    print('-' * 80)
    for beta in (0.0, 0.15, 0.30, 0.45, 0.60):
        o, tot, keep = pattern(bid_scale=0.0065, beta=beta)
        rmse = np.sqrt(np.nanmean([(o[l] - REAL[l]) ** 2 for _, _, l in BUCKETS]))
        print('%-8.2f %7.2f %7.3f  %s   RMSE %.2f'
              % (beta, tot, keep,
                 ' '.join('%7.2f' % o[l] for _, _, l in BUCKETS), rmse))
    print()
    print('판정: 최소 RMSE 1.60 (beta=0.30). 잔차가 구조적이다 —')
    print('  N<=2 는 더 약한 콜라이더를, N=3-4 는 더 센 콜라이더를 동시에 요구한다.')
    print('  단일 파라미터 N 의존은 단조 패턴만 만들므로 둘을 같이 만족시킬 수 없다.')
