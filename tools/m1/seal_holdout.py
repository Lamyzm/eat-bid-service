# -*- coding: utf-8 -*-
"""홀드아웃 봉인 — 시간 전방 + 지역 신규성 층화.

🔴 무작위 분할은 반려됐다. 이유가 결정적이다:
    무작위로 나누면 조율/봉인의 구성이 거의 같아진다. 내가 "자동으로 같아진다"고
    보고한 그 균형(신규지역 0.1539 vs 0.1536)이 바로 결함이다 —
    구성이 같으면 조율 반쪽에서 얻은 개선이 봉인 반쪽으로 거의 완벽히 전이된다.
    ⟹ 거의 무엇이든 확인해 주는 홀드아웃이다. 홀드아웃이 아니라 분산 추정치다.
    잡음 과적합은 잡지만 구성·시간 과적합은 구조적으로 못 잡는다.

    그리고 내가 낸 ⑤ 발견("학습 3년 안에서도 시간 변화가 있다")이 정확히
    무작위 분할로는 볼 수 없는 것이다. 전방 이동을 의심하는 증거를 내놓고
    그걸 볼 수 없는 분할을 고르면 안 된다.

확정 (team-lead):
    학습   2023-09 ~ 2025-12
    조율   2026-01 ~ 05          마음껏 봐도 된다
    봉인   2026-06 ~ 08          🔴 지역 신규성으로 층화해서 보고한다
             A 기존지역  ← 01~05 과 직접 비교 가능. 시간 전방 추정치
             B 신규지역  ← 외삽 추정치. 따로 보고

구성 불균형(신규지역 0.09% vs 39.65%)은 *분할을 바꿔서*가 아니라
*층화해서 보고*하는 것으로 통제한다 — §2-FX 에서 이미 내린 결정이고,
그때 그 결정으로 낙관 상한 3.74 %p 를 계산했다.
"""
from __future__ import annotations

import os

import numpy as np

OUT = r'F:/Project/eat-bid/data/mechanism/holdout.npz'
NEW_SIDO = {'3', '6', '4', '14', '9', '7', '16', '10', '11'}

A = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
ym = A['ym'].astype(int)
sido = A['sido'].astype(str)
nbid = A['nbid'].astype(int)
isnew = np.isin(sido, list(NEW_SIDO))

split = np.full(len(ym), '', dtype='U6')
split[(ym >= 202601) & (ym <= 202605)] = 'TUNE'
seal = (ym >= 202606) & (ym <= 202608)
split[seal & ~isnew] = 'HOLD_A'          # 기존 지역 — 시간 전방 추정치
split[seal & isnew] = 'HOLD_B'           # 신규 지역 — 외삽 추정치

print('=== 봉인 구성표 ===')
print('  %-12s %9s %10s %8s %9s' % ('', '회차', '신규지역%', '중앙N', 'N=3-4%'))
for lab, nm in [('TUNE', '조율 01~05'), ('HOLD_A', '봉인A 기존'),
                ('HOLD_B', '봉인B 신규')]:
    q = split == lab
    if not q.sum():
        continue
    print('  %-12s %9d %10.4f %8d %9.4f'
          % (nm, q.sum(), isnew[q].mean(), np.median(nbid[q]),
             ((nbid[q] >= 3) & (nbid[q] <= 4)).mean()))
print()
print('  🔴 TUNE 과 HOLD_A 가 직접 비교 가능하다 (둘 다 기존 지역).')
print('     그 차이가 곧 시간 전방 손실이고, 무작위 분할로는 볼 수 없던 값이다.')

if os.path.exists(OUT):
    os.remove(OUT)
    print('\n  (이전 무작위 봉인 파일 삭제 — 반려됐다)')
np.savez_compressed(OUT, bid_id=A['bid_id'], split=split)
print('\n✅ 봉인: %s' % OUT)
print('   TUNE 만 본다. HOLD_A / HOLD_B 는 최종 수치를 낼 때만.')
