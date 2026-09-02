# -*- coding: utf-8 -*-
"""α 규칙 검사 — 회차별 α 를 후보 범위에서 추정해 규칙과 대조한다.

E[max - min] = α(8/9 + 7/8) = 1.763889 α   (8/7 층화 · 밴드 내 균등)

판정(개정 18): 규칙은 정밀도 92% · 재현율 24%. α<0.03 인 회차가 11.3% 인데
규칙은 그중 1/4 만 잡는다. 그게 f_R 의 sd 가 실측보다 3.4% 큰 원인이다.
"""
import numpy as np

P = np.load(r'F:/Project/eat-bid/data/mechanism/plist.npz', allow_pickle=True)
rate, floor, bgng = P['rate'], P['floor'], P['bgng']
ahat = (rate.max(1) - rate.min(1)) / 1.763889

print('회차별 α̂  p1/p5/p25/p50/p75/p95/p99 = %s'
      % np.round(np.percentile(ahat, [1, 5, 25, 50, 75, 95, 99]), 5))
print('%-24s %8s %9s %9s' % ('구간', 'n', 'α̂ 중앙', '규칙값'))
for f in (88, 90):
    for lbl, q in [('<2,000만', bgng < 2e7), ('>=2,000만', bgng >= 2e7)]:
        s = (floor == f) & q
        if s.sum() < 200:
            continue
        rule = 0.02 if (f == 88 and '<' in lbl) else 0.03
        print('  하한%d · %-14s %8d %9.5f %9.3f'
              % (f, lbl, s.sum(), np.median(ahat[s]), rule))

lo = ahat < 0.025
hit = (floor == 88) & (bgng < 2e7)
print()
print('α̂ < 0.025 인 회차            %.4f (%d)' % (lo.mean(), lo.sum()))
print('  정밀도  규칙 0.02 중 실제 낮은 비율   %.4f' % lo[hit].mean())
print('  재현율  실제 낮은 것 중 규칙이 잡는 비율 %.4f' % hit[lo].mean())
