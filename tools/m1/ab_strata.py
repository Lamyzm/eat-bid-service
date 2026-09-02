# -*- coding: utf-8 -*-
"""A/B 층화 — P(alpha|z) 의 내삽/외삽 성능을 갈라 낙관 상한을 계산한다.

stats-expert 처방: 자르지도 두지도 말고 층으로 가른다.
    A  학습에 있던 단위    -> 내삽 성능
    B  평가에만 있는 단위  -> 외삽 성능
    낙관 상한 = (B 비율) x (A 성능 - B 성능)

🔴 A/B 는 *학습 기간*의 단위 목록으로 정한다. 평가를 보고 정하면 순환이다.

⚠ asof.npz 에 지역 필드가 없다. purr(발주기관, 6자리 코드)는 지역 접두가 없다.
   대신 **기관 신규성**을 쓴다 — 2026 에만 들어온 9개 시도의 기관은 전부 신규이므로
   기관 신규성이 지역 신규성의 상위집합이고, 더 엄격한 기준이다.
"""
import numpy as np
import p_alpha_gate as PA

A = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
purr, ym = A['purr'], A['ym'].astype(int)
y, g, te = PA.y, PA.g, PA.EVAL
seen = set(np.unique(purr[g & (ym <= 202512)]))
isA = np.array([s in seen for s in purr])

p, glob = PA.fit(3.0)
p = PA.recal_forward(p, glob)
out = {}
for lbl, m in [('전체', te), ('A 내삽', te & isA), ('B 외삽', te & ~isA)]:
    t = y[m]
    b = np.mean((p[m] - t) ** 2)
    b0 = np.mean((glob - t) ** 2)
    d = PA.murphy(p[m], t)
    out[lbl] = (1 - b / b0, m.sum())
    print('  %-8s n=%6d  Brier %.6f  vs 전역 %+6.1f%%   신뢰도 %.6f  분해능 %.6f'
          % (lbl, m.sum(), b, 100 * (1 - b / b0), d['rel'], d['res']))
gA, nA = out['A 내삽']
gB, nB = out['B 외삽']
gT, nT = out['전체']
w = nB / nT
print('\n  낙관 상한 = %.3f x %.1f%%p = %.2f %%p   (전체 %+.1f%%)'
      % (w, 100 * (gA - gB), 100 * w * (gA - gB), 100 * gT))
