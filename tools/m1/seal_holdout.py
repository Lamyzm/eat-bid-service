# -*- coding: utf-8 -*-
"""홀드아웃 봉인 — 평가 기간 안에서 회차 단위 무작위 분할.

🔴 시간으로 자르면 안 된다. 구성표가 잡았다:
    2026-01~05  신규지역 0.09%
    2026-06~08  신규지역 39.65%      ← 400배. 시간 분할이 지역 분할이 된다

무작위(회차 단위)는 자동으로 균형이 맞는다 (검증됨):
    조율(A) 28,505  신규지역 0.1539  중앙N 15  N=3-4 0.1086
    봉인(B) 28,594  신규지역 0.1536  중앙N 15  N=3-4 0.1053

⚠ 회차 단위여야 한다. 투찰 단위로 나누면 같은 R 을 공유하는 투찰이 양쪽에 걸린다.
⚠ 시드를 고정하고 파일로 굳힌다. 다시 뽑으면 봉인이 아니다.

이 파일이 만들어진 뒤로:
    A(조율)  진단·모형 조율에 마음껏 쓴다
    B(봉인)  최종 수치를 낼 때만. 그 전에는 읽지 않는다
"""
from __future__ import annotations

import os

import numpy as np

OUT = r'F:/Project/eat-bid/data/mechanism/holdout.npz'
SEED = 20260902

A = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
ym = A['ym'].astype(int)
bid_id = A['bid_id']
sido = A['sido'].astype(str)
nbid = A['nbid'].astype(int)

EVAL = ym >= 202601
idx = np.flatnonzero(EVAL)
rng = np.random.default_rng(SEED)
tune = rng.random(len(idx)) < 0.5          # 회차 단위. True = 조율(A)

split = np.full(len(ym), '', dtype='U4')
split[idx[tune]] = 'A'
split[idx[~tune]] = 'B'

NEW = {'3', '6', '4', '14', '9', '7', '16', '10', '11'}
isnew = np.isin(sido, list(NEW))
print('=== 봉인 구성표 (기록용) ===')
print('  %-10s %9s %10s %8s %9s' % ('', '회차', '신규지역%', '중앙N', 'N=3-4%'))
for lab in ('A', 'B'):
    q = split == lab
    print('  %-10s %9d %10.4f %8d %9.4f'
          % ('조율(A)' if lab == 'A' else '봉인(B)', q.sum(), isnew[q].mean(),
             np.median(nbid[q]), ((nbid[q] >= 3) & (nbid[q] <= 4)).mean()))

if os.path.exists(OUT):
    print('\n🔴 이미 봉인돼 있다. 덮어쓰지 않는다 — 다시 뽑으면 봉인이 아니다.')
else:
    np.savez_compressed(OUT, bid_id=bid_id, split=split, seed=SEED)
    print('\n✅ 봉인: %s  (seed=%d)' % (OUT, SEED))
    print('   A 는 조율용. B 는 최종 수치를 낼 때만 연다.')
