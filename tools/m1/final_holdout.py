# -*- coding: utf-8 -*-
"""최종 수치 — `HOLD_A` / `HOLD_B`.  🔴 팀리드 승인 없이는 실행되지 않는다.

사전 등록 (§2-FX-H2, 결과 보기 전에 못박음):
    🔴 HOLD_A 수치가 보고 수치다.  단서 없이
    🔴 TUNE − HOLD_A 격차는 **낙관의 크기**로 보고한다.  설명하지 않는다
    🔴 격차를 보고 모형을 고치지 않는다.  고치면 HOLD_A 가 두 번째 TUNE 이 된다

모형은 **여기서 아무것도 고르지 않는다.** 전부 TUNE 에서 확정됐다:
    지수 N−1 · 연속 커널 h=0.02 (상한 없음) · 회차별 α · F_X 는 ym 202308~202512
    N̂ 은 nhat_tune2 정본 (ALPHA=2 · T=1.0)

⚠ 실행: EATBID_OPEN_HOLDOUT=<팀리드 승인 커밋 해시> 를 설정해야 돈다.
⚠ 한 번 돌리면 봉인이 소진된다. 두 번째 실행은 두 번째 TUNE 이다.
"""
from __future__ import annotations

import os
import sys

import numpy as np

APPROVAL = os.environ.get('EATBID_OPEN_HOLDOUT', '')
if not APPROVAL:
    sys.exit('🔴 봉인. EATBID_OPEN_HOLDOUT=<팀리드 승인 커밋 해시> 없이는 못 연다.\n'
             '   TUNE 수치는 fx_kernel.py / marginalize_nhat.py 로 낸다.')

import fx_kernel as K                                       # noqa: E402

H = 0.02
HO = K.HO
hs = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
SPLIT = np.array([hs.get(b, '') for b in K.XC['bid_id']])

print('승인 %s' % APPROVAL)
for lab in ('TUNE', 'HOLD_A', 'HOLD_B'):
    q = SPLIT == lab
    print('  %-7s 회차 %6d · 투찰 %8d' % (lab, q.sum(), K.cnt[q].sum()))


def evaluate(mask, label):
    """그 분할에서 층별 미보정 + Murphy.  🔴 여기서 아무것도 고르지 않는다."""
    sel = mask[K.aid]
    K.XI, K.AI = K.x[sel], K.aid[sel]
    K.NT = K.nbid[K.AI]
    v = K.x >= K.R[K.aid]
    xv = np.where(v, K.x, 1e9)
    o = np.lexsort((xv, K.aid))
    f = np.ones(len(K.x), bool)
    f[1:] = K.aid[o][1:] != K.aid[o][:-1]
    w = np.zeros(len(K.x), bool)
    wi = o[f]
    w[wi] = v[wi]
    K.ACT = w[sel].astype(float)
    K.UNQ = np.unique(K.NT)
    K.GRP = {int(n): np.flatnonzero(K.NT == n) for n in K.UNQ}
    p = K.predict(H)
    print('\n--- %s (투찰 %d · 회차 %d · 실제 낙찰률 %.4f) ---'
          % (label, len(K.XI), mask.sum(), K.ACT.mean()))
    print('대역 %s' % ' '.join('%d-%d' % b for b in K.BANDS))
    bg, bl, rows = K.report(p, label)
    for (lo, hi), r in zip(K.BANDS, rows):
        if np.isfinite(r[0]):
            print('    N %-8s 미보정 %+6.1f ± %.1f%%   투찰 %8d   회차 %7d'
                  % ('%d-%d' % (lo, hi), r[0], r[1], r[2], r[3]))
    return p


if __name__ == '__main__':
    for lab in ('TUNE', 'HOLD_A', 'HOLD_B'):
        evaluate((SPLIT == lab) & (K.nbid >= 3), lab)
    print('\n🔴 보고 수치는 HOLD_A 다. TUNE − HOLD_A 는 낙관의 크기로만 적는다.')
    print('   HOLD_B(신규 지역)는 별도로 적는다 — 콜드스타트 성능이지 같은 양이 아니다.')
    print('   격차를 설명하지 않는다. 격차를 보고 모형을 고치지 않는다.')
