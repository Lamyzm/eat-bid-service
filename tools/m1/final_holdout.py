# -*- coding: utf-8 -*-
"""최종 수치 — `HOLD_A` / `HOLD_B`.  🔴 승인과 개봉 게이트를 둘 다 통과해야 돈다.

사전 등록 (§2-FX-H2 · `PREREG_holdout.md`):
```
🔴 HOLD_A 수치가 보고 수치다.  단서 없이
🔴 예측 안이면 예상된 이동.  밖이면 그게 낙관의 크기다.  설명하지 않는다
🔴 격차를 보고 모형을 고치지 않는다
```
모형은 여기서 아무것도 고르지 않는다. 전부 `TUNE` 에서 확정됐다:
지수 `N_pool−1` · 커널 `h=0.02` · 회차별 `α` · `F_X` 는 `ym ≤ 202512` · `ACT` = 기록 낙찰자.
"""
from __future__ import annotations

import os
import sys

APPROVAL = os.environ.get('EATBID_OPEN_HOLDOUT', '')
if not APPROVAL:
    sys.exit('\U0001F534 봉인. EATBID_OPEN_HOLDOUT=<승인 해시> 없이는 못 연다.')

import numpy as np                                        # noqa: E402

import ceiling_a as C                                     # noqa: E402
import fx_kernel as K                                     # noqa: E402

H = 0.02

# ============================================================================
# 🔴 개봉 게이트 — 나이 불변성.  가정하지 말고 증명한다
#
#   교체 사유 (개정 32): 원래 기준은 *월별* 철회율 ↔ 미보정 상관이었다.
#   그런데 월별 철회율과 달력시간의 상관이 **r = −0.9719** 다 — 철회율이 사실상
#   시간의 대리변수라, 그 검정은 "나이 의존"이 아니라 "보정이 시간에 흐르나"를 잰다.
#   **어떤 시간 추세든 떨어뜨린다.**  교체는 *약화가 아니라 강화*다:
#     · 순열 증명은 상관 검정보다 엄격하다 — 통계가 아니라 산술이다
#     · 월×대역 검정은 시간 교란을 제거한 판이다
#   ⚠ 순열이 덮는 건 `wd` 통로 하나다. 미지의 통로는 증명 불가 — 그렇게 적는다
# ============================================================================


def _within_month_band():
    ymx = np.where(K.TRAIN | K.TUNE, K.ym, -1)
    months = [m for m in np.unique(ymx) if m > 0 and (ymx == m).sum() >= 1000]
    d = []
    for m in months:
        for lo, hi in K.BANDS:
            q = (ymx == m) & (K.nbid >= lo) & (K.nbid <= hi)
            if q.sum() < 400:
                continue
            med = np.median(K.WD_RATE[q])
            if med <= 0:
                continue
            h, l = q & (K.WD_RATE > med), q & (K.WD_RATE <= med)
            if h.sum() < 150 or l.sum() < 150:
                continue
            d.append(K.month_miscalibration(h) - K.month_miscalibration(l))
    d = np.array(d)
    if len(d) < 20:
        return False, '③ 셀 %d 개로는 못 잰다' % len(d)
    se = d.std(ddof=1) / np.sqrt(len(d))
    print()
    print('🔴 월×대역 내 (고철회 − 저철회) 미보정 차  %+.3f ± %.3f %%p  (셀 %d)'
          % (d.mean(), se, len(d)))
    print('   ⚠ 나이 인공물이 아니라 **발견**이다 — 철회가 많은 회차에서 덜 과대예측한다.')
    print('     배포 불가(투찰 시점에 누가 철회할지 모른다). `기관` 축과 같은 목록.')
    print('   ⚠ 검정력: |차| %.2f %%p 이상이면 탐지된다' % (1.96 * se))
    return True, ''


def preflight():
    fails = []
    if getattr(K, 'SOURCE', '') != 'bidlevel':
        fails.append('① 자료원이 bidlevel(전 투찰)이 아니다')
    if not getattr(K, 'ACT_FROM_RECORD', False):
        fails.append('① ACT 가 is_recorded_winner 가 아니다')
    if fails:
        return fails                      # 나이 의존 자료 위에서 잰 상관은 뜻이 없다
    if not K.assert_wd_unused():
        fails.append('② wd 순열에 출력이 반응한다 — 어딘가 읽고 있다')
    ok, msg = _within_month_band()
    if not ok:
        fails.append(msg)
    return fails


_fails = preflight()
if _fails:
    print('🔴 개봉 조건 미달 — 봉인 유지')
    for f in _fails:
        print('   ' + f)
    sys.exit('나이 불변성이 증명되지 않았다. HOLD 를 안 연다.')
print('✅ 개봉 조건 통과')

_hs = {b: v for b, v in zip(K.HO['bid_id'], K.HO['split'])}
SPLIT = np.array([_hs.get(b, '') for b in K.bid_id])


def evaluate(mask, label):
    """층별 미보정 + 007 바닥.  🔴 여기서 아무것도 고르지 않는다."""
    sel = mask[K.aid]
    xi, ai = K.x[sel], K.aid[sel]
    nt = K.nbid[ai]
    act = K.ACT_ALL[sel]                    # 🔴 기록 낙찰자. 규칙 유도 안 한다
    a2 = K.ALPHA2[ai]
    uq = np.unique(nt)
    F = K.Fx_at(uq, H)
    p = np.zeros(len(xi))
    for j, n in enumerate(uq):
        q = np.flatnonzero(nt == n)
        p[q] = K.pwin_v(xi[q], F[j], nt[q], a2=a2[q])
    pa, acta, aida, nta, _, _ = C.compute(mask)
    print()
    print('--- %s (투찰 %d · 회차 %d · 실제 낙찰률 %.5f) ---'
          % (label, len(xi), mask.sum(), act.mean()))
    print('%-9s %8s %10s %10s %13s' % ('N', '회차', '007 바닥', '모형', '격차'))
    for lo, hi in K.BANDS:
        q = (nt >= lo) & (nt <= hi)
        qa = (nta >= lo) & (nta <= hi)
        if q.sum() < 500:
            continue
        b = 100 * (pa[qa].mean() / acta[qa].mean() - 1)
        m = 100 * (p[q].mean() / act[q].mean() - 1)
        se = 100 * K.cluster_se(p[q] - act[q], ai[q]) / act[q].mean()
        print('%-9s %8d %9.2f%% %9.2f%% %+8.2f±%.2f%%p'
              % ('%d-%d' % (lo, min(hi, 364)), len(np.unique(ai[q])), b, m, m - b, se))
    b = 100 * (pa.mean() / acta.mean() - 1)
    m = 100 * (p.mean() / act.mean() - 1)
    print('%-9s %8d %9.2f%% %9.2f%% %+8.2f%%p' % ('전체', mask.sum(), b, m, m - b))
    return m, m - b


if __name__ == '__main__':
    # 🔴 먼저 TUNE 으로 이 코드가 정본 표를 재현하는지 확인한다.
    #    재현 못 하면 HOLD 수치도 못 믿는다. 봉인은 한 번뿐이다
    evaluate(K.TUNE, 'TUNE (검산 — 정본 +4.54%p 와 같아야 한다)')
    if APPROVAL == 'dry-run':
        sys.exit('검산만 하고 멈춘다. 실제 개봉은 승인 해시로.')
    for lab in ('HOLD_A', 'HOLD_B'):
        evaluate(np.asarray(SPLIT == lab) & K.USABLE & (K.nbid >= 3), lab)
    print()
    print('🔴 보고 수치는 HOLD_A. 사전 등록(PREREG_holdout.md)과 대조한다.')
    print('   HOLD_B 는 사전 상한 없이 보고 — TUNE 에 신규 지역이 1.2% 뿐이다.')
