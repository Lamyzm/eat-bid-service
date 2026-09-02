# -*- coding: utf-8 -*-
"""모듈 책임: 기준 사용자 대결 — 표 하나.

```
아버지 실제      그가 넣은 자리에서 그가 이긴 비율
제비뽑기         같은 자리에서 무작위였다면      Σ 1/Nᵢ / 투찰수
우리 모형        같은 자리에 우리를 넣었다면
낙찰 시 평균 x   그가 이길 때 vs 우리가 이길 때   ← "싸게 이긴 것 아니냐"를 닫는다
```

조건 셋 (team-lead):
```
1. 같은 회차 · 같은 실현 R · 같은 실현 경쟁자.  그의 자리에만 우리를 넣는다
   ⟹ 투찰 하나씩 대체한다.  그가 한 회차에 여러 건 넣으면 나머지는 경쟁자로 남는다
2. 🔴 가격 제약 없이 모형이 자기 최적을 고른다.  대신 낙찰 시 평균 x 를 옆에 낸다
3. 창 분리: 학습기 / TUNE / HOLD.  HOLD 는 **새 봉인 아님**
```
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K
import headtohead as HH

FATHER = ('3118152843', '7175001228')
BIZ = K.BL['biz_no']
IS_F = np.isin(BIZ, FATHER)


def table(mask_bid, label, note=''):
    """mask_bid: 투찰 단위 bool. 그 부분집합에 대해 세 줄 + 낙찰 시 평균 x."""
    idx = np.flatnonzero(mask_bid)
    if len(idx) < 30:
        print('  %-22s 투찰 %d — 표본 부족' % (label, len(idx)))
        return
    ai = K.aid[idx]
    xi = K.x[idx]
    Ra = K.R[ai]
    n = K.nbid[ai]
    a2 = K.ALPHA2[ai].astype(int)
    act = K.ACT_ALL[idx]

    # 그를 뺀 최소 유효 투찰 m₋ᵢ  (자기 자신만 제외.  그의 다른 투찰은 경쟁자로 남는다)
    valid = K.x >= K.R[K.aid]
    big = np.where(valid, K.x, np.inf)
    o = np.lexsort((big, K.aid))
    xs, as_ = big[o], K.aid[o]
    first = np.ones(len(xs), bool)
    first[1:] = as_[1:] != as_[:-1]
    m1 = np.full(len(K.nbid), np.inf)
    m1[as_[first]] = xs[first]
    sec = np.zeros(len(xs), bool)
    sec[1:] = first[:-1] & (as_[1:] == as_[:-1])
    m2 = np.full(len(K.nbid), np.inf)
    m2[as_[sec]] = xs[sec]
    is_min = valid[idx] & (xi <= m1[ai])
    m_excl = np.where(is_min, m2[ai], m1[ai])

    xm = HH.decide(n, a2, 1.0)                 # 🔴 가격 제약 없음. 모형 자기 최적
    win_m = (xm >= Ra) & (xm <= m_excl)
    lottery = (1.0 / n).mean()                 # 제비뽑기: 회차마다 1/N

    print('  %-22s 투찰 %5d · 회차 %5d%s'
          % (label, len(idx), len(np.unique(ai)), note))
    print('    아버지 실제   %6.2f%%   (낙찰 %d)' % (100 * act.mean(), int(act.sum())))
    print('    제비뽑기      %6.2f%%' % (100 * lottery))
    print('    우리 모형     %6.2f%%   (낙찰 %d)' % (100 * win_m.mean(), int(win_m.sum())))
    hw = xi[act > 0]
    mw = xm[win_m]
    print('    낙찰 시 평균 x   아버지 %.5f  vs  모형 %.5f   차 %+.2f%%'
          % (hw.mean() if len(hw) else np.nan, mw.mean() if len(mw) else np.nan,
             100 * (mw.mean() / hw.mean() - 1) if len(hw) and len(mw) else np.nan))
    print()
    return act, win_m, xi, xm, n


if __name__ == '__main__':
    base = IS_F & K.USABLE[K.aid] & (K.nbid[K.aid] >= 3)
    ym = K.ym[K.aid]
    print('=== 기준 사용자 대결 — 오뚜기축산 3118152843 · 신성유통 7175001228 ===')
    print('같은 회차 · 같은 실현 R · 같은 실현 경쟁자.  그의 투찰 하나씩 대체.')
    print('🔴 가격 제약 없음 — 모형이 자기 최적을 고른다\n')
    table(base, '전체')
    table(base & (ym <= 202512), '학습기 (~2025-12)', '   ⚠ 표본 내')
    table(base & (ym >= 202601) & (ym <= 202605), 'TUNE (2026-01~05)', '   ⚠ h 를 여기서 골랐다')
    table(base & (ym >= 202606), 'HOLD (2026-06~08)', '   🔴 새 봉인 아님')

    print('--- 별지: N 층 (본 표 아님) ---')
    for lo, hi in K.BANDS:
        q = base & (K.nbid[K.aid] >= lo) & (K.nbid[K.aid] <= hi)
        table(q, 'N %d-%d' % (lo, min(hi, 364)))
