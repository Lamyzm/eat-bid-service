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


# ============================================================================
# 🔴 개봉 조건 — 나이 불변성 증명 (team-lead).  통과 못 하면 봉인을 안 연다.
#
#   기록 지연이 확인됐다: 철회 플래그가 ~18개월에 걸쳐 쌓인다.
#   2026-07·08 은 517,202 투찰에서 정확히 0.0000% 다.
#   ⟹ TUNE(2026-01~05)과 HOLD_A(2026-06~08)이 라벨 완성도에서 다르다.
#   ⟹ A(철회 포함)로 재구축하면 파이프라인이 나이 의존 양을 하나도 안 쓴다.
#      그걸 **가정하지 말고 증명한다**.
# ============================================================================

AGE_DEPENDENT = ('wd 플래그', 'nbid(생존자)', 'xcap 행 집합', '규칙 유도 낙찰자')

# 🔴 사전 등록 임계 — 결과 보기 전에 정한다
MAX_ABS_R = 0.5          # 월별 철회율 ↔ 월별 미보정 상관의 절대값 상한
REQUIRE_CI_COVERS_0 = True


def preflight():
    """세 단계. 전부 통과해야 HOLD 를 연다."""
    fails = []

    # ── 1. 자료원 감사 — 승률 경로에 나이 의존 양이 남아 있나
    base = getattr(K, 'SOURCE', 'xcap')
    if base != 'bidlevel':
        fails.append('① 자료원이 %s 다. bidlevel(전 투찰)이어야 한다' % base)
    if not getattr(K, 'ACT_FROM_RECORD', False):
        fails.append('① ACT 가 규칙 유도다. is_recorded_winner 여야 한다')

    # 🔴 ①이 실패하면 여기서 멈춘다 — 나이 의존 자료 위에서 잰 상관은 뜻이 없다
    if fails:
        return fails

    # ── 2·3. 월별 미보정이 철회율과 상관이 있나
    #    ⚠ 이건 *부재의 증거*를 요구하는 검정이다. 검정력을 같이 낸다.
    ok, msg = _month_corr()
    if not ok:
        fails.append(msg)
    return fails


def _month_corr():
    # 🔴 봉인 구간(202606~)은 안 쓴다 — 게이트를 돌리려고 봉인을 열면 순환이다.
    #    학습기+TUNE 만 쓴다.  철회율 범위가 12.67% ~ 0.56% 라 상관 검정에 충분히 넓다.
    #    ⚠ 학습기는 표본 내라 *수준*은 낙관이다. 우리가 보는 건 수준이 아니라 상관이다.
    ym = np.where(K.TRAIN | K.TUNE, K.ym, -1)
    months = [m for m in np.unique(ym) if m > 0 and (ym == m).sum() >= 1000]
    if len(months) < 8:
        return False, '②③ 월 수 %d 개로는 상관을 못 잰다' % len(months)
    wr, mis = [], []
    for m in months:
        q = (ym == m)
        wr.append(K.WD_RATE[q].mean())
        mis.append(K.month_miscalibration(q))
    wr, mis = np.array(wr), np.array(mis)
    r = float(np.corrcoef(wr, mis)[0, 1])
    n = len(months)
    z = np.arctanh(r)
    se = 1 / np.sqrt(n - 3)
    lo, hi = np.tanh(z - 1.96 * se), np.tanh(z + 1.96 * se)
    # 검정력: 이 n 에서 유의해지는 최소 |r|
    r_det = float(np.tanh(1.96 / np.sqrt(n - 3)))
    print()
    print('🔴 나이 불변성 검정  월 %d 개' % n)
    print('   철회율 ↔ 미보정 상관  r = %+.3f   95%% CI [%+.3f, %+.3f]' % (r, lo, hi))
    print('   ⚠ 검정력: 이 표본에서 탐지 가능한 최소 |r| = %.3f' % r_det)
    print('     ⟹ 그보다 작은 상관은 이 검정이 **못 본다**. 통과를 "없다"로 읽지 마라')
    if abs(r) >= MAX_ABS_R:
        return False, '②③ |r| = %.3f 가 임계 %.2f 이상이다' % (abs(r), MAX_ABS_R)
    if REQUIRE_CI_COVERS_0 and not (lo <= 0 <= hi):
        return False, '②③ 상관 CI [%.3f, %.3f] 가 0 을 안 덮는다' % (lo, hi)
    return True, ''


_fails = preflight()
if _fails:
    print('🔴 개봉 조건 미달 — 봉인 유지')
    for f in _fails:
        print('   ' + f)
    sys.exit('나이 불변성이 증명되지 않았다. HOLD 를 안 연다.')
print('✅ 개봉 조건 통과 — 나이 불변성 증명됨')

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
