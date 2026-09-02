# -*- coding: utf-8 -*-
"""예정가격 메커니즘 합성 생성기 — L1(구현 검증)용.

명세 출처: docs/experiments/2026-09-01-ml-review.md 4-4 (개정 14)
확정 사항만 넣는다. 미지수는 손잡이로 열어 둔다.

    후보 15개  구간 배분 고정(아래 8, 위 7), 각 구간 안에서 iid
               아래 8 ~ U(0.97,1.00),  위 7 ~ U(1.00,1.03)
               -> 무작위 순열로 슬롯 1..15 배정   (슬롯<->가격 독립)
    투표       철회자 포함 전원이 15칸 중 2칸. 슬롯 선호 pi_k 는 실측 15칸
    선택       득표 상위 4. 동점은 낮은 슬롯 우선. 득표<4 면 채움(가격 무관)
    투찰       x = 투찰금액/(기초가*하한율/100). 상한 = 기초가격
    관측 필터  007 만 — max_j x_j >= R 인 회차만 살아남는다   <- 이게 핵심 시험

  원칙 0: 모먼트 하나가 맞는다고 구조가 맞은 게 아니다.
  통과 기준 여섯을 전부 재고, 어느 것이 안 맞는지 개별로 보고한다.
"""
from __future__ import annotations

import numpy as np

# ---- 실측 상수 (전수 233,329 회차) ------------------------------------------
# 원칙 1: 분포를 지어내지 않는다. pi 와 참여자 수는 실측을 그대로 쓴다.
#
# 🔴 첫 판에서 내가 여기를 틀렸다. PI_SLOT 을 P(뽑힘|슬롯) 으로 넣었는데
#    그건 "상위 4 선택을 거친 뒤"의 값이라 투표 확률보다 4.9배 더 집중돼 있다
#    (최대/최소 56.3배 vs 실제 11.4배). 그 결과 동점률·채움률이 크게 어긋났다.
#    투표 확률은 votes_all 의 슬롯별 득표 비율이다.
_C = np.load(r'F:/Project/eat-bid/data/mechanism/_synth_const.npz')
PI_SLOT = _C['pi']                      # 실제 투표 분포 (최대/최소 11.4배)
NVOTER_EMP = _C['nvoter_all']           # 실측 투표자 수 (중앙 15, 평균 41, p90 123)

TARGET = dict(mean_D_bp=-2.000, sd_R=0.007605, sd_meanr=0.002166,
              frac_below_1=0.5300, tie_rate=0.48221, fill_rate=0.02742,
              anchor_filtered_bp=-11.33, anchor_unfiltered_bp=-10.00)


def draw_candidates(n, rng):
    """구간 배분 고정 + 구간 내 iid + 슬롯 무작위 배정."""
    lo = rng.uniform(0.97, 1.00, (n, 8))
    hi = rng.uniform(1.00, 1.03, (n, 7))
    vals = np.concatenate([lo, hi], axis=1)
    perm = rng.permuted(np.tile(np.arange(15), (n, 1)), axis=1)
    return np.take_along_axis(vals, perm, axis=1)


def draw_votes(n, nvoter, rng, pi=None):
    """각 투찰자가 서로 다른 2칸을 고른다. 슬롯 선호는 pi 에 비례."""
    p = (PI_SLOT if pi is None else pi).astype(float)
    p = p / p.sum()
    V = np.zeros((n, 15), dtype=np.int32)
    for k in range(int(nvoter.max())):
        act = nvoter > k
        m = int(act.sum())
        if not m:
            break
        a = rng.choice(15, size=m, p=p)
        b = rng.choice(15, size=m, p=p)
        clash = a == b
        while clash.any():
            b[clash] = rng.choice(15, size=int(clash.sum()), p=p)
            clash = a == b
        idx = np.flatnonzero(act)
        np.add.at(V, (idx, a), 1)
        np.add.at(V, (idx, b), 1)
    return V


def select_four(V, rng, fill_low_bias=3.0):
    """득표 상위 4. 동점은 낮은 슬롯 우선. 득표<4 면 채움(가격 무관)."""
    n = len(V)
    key = V.astype(np.int64) * 16 - np.arange(15)
    order = np.argsort(-key, axis=1)
    chosen = np.zeros((n, 15), dtype=bool)
    np.put_along_axis(chosen, order[:, :4], True, axis=1)

    need = (V > 0).sum(1) < 4
    if need.any():
        w = fill_low_bias ** (-np.arange(15) / 14.0)
        for i in np.flatnonzero(need):
            voted = np.flatnonzero(V[i] > 0)
            chosen[i] = False
            chosen[i, voted] = True
            pool = np.flatnonzero(V[i] == 0)
            k = 4 - len(voted)
            pw = w[pool] / w[pool].sum()
            chosen[i, rng.choice(pool, size=k, replace=False, p=pw)] = True
    return chosen, need


def simulate(n=233000, seed=0, apply_007_filter=True, nvoter=None,
             fill_low_bias=3.0, floor=0.90, bid_scale=0.010, beta=0.0):
    """한 코퍼스를 만든다. apply_007_filter 가 이 생성기의 핵심 스위치다."""
    rng = np.random.default_rng(seed)
    rate = draw_candidates(n, rng)
    if nvoter is None:                                   # 실측 경험분포에서 리샘플
        nvoter = rng.choice(NVOTER_EMP, size=n, replace=True).astype(np.int64)
        nvoter = np.maximum(nvoter, 1)
    V = draw_votes(n, nvoter, rng)
    chosen, filled = select_four(V, rng, fill_low_bias)

    R = (rate * chosen).sum(1) / 4.0
    mean_r = rate.mean(1)

    # 투찰: 하한 근처에 몰린 우편향. 상한 = 기초가격.
    # 🔴 beta > 0 이면 투찰 산포가 N 에 의존한다 — "경쟁이 적으면 높게 넣는다".
    #    실측 xmax/R 중앙이 N 이 커질수록 내려가는데, 투찰 분포가 고정이면
    #    xmax 는 N 개의 최댓값이라 올라가야 한다. 부호가 반대다(개정 15).
    #    ⚠ 실측 xmax 로 보정하면 순환이다(xmax 자체가 007 조건부).
    #      자유 파라미터로 두고 "어떤 beta 로도 못 맞추면 빠진 게 더 있다"를 시험한다.
    s_n = bid_scale * (nvoter / 14.0) ** (-beta)
    x = 1.0 + rng.gamma(1.6, 1.0, (n, int(nvoter.max()))) * s_n[:, None]
    live = np.arange(x.shape[1])[None, :] < nvoter[:, None]
    x = np.where(live, np.minimum(x, 1.0 / floor), -np.inf)
    xmax = x.max(1)

    keep = (xmax >= R) if apply_007_filter else np.ones(n, bool)
    return dict(rate=rate[keep], chosen=chosen[keep], R=R[keep],
                mean_r=mean_r[keep], V=V[keep], filled=filled[keep],
                xmax=xmax[keep], nvoter=nvoter[keep], keep_rate=float(keep.mean()))


def report(s, label, verbose=True):
    D = s['R'] - s['mean_r']
    sv = -np.sort(-s['V'], axis=1)
    has4 = (s['V'] > 0).sum(1) >= 4
    tie = (has4 & (sv[:, 3] == sv[:, 4])) | ~has4          # 정의 B (C 포함)
    out = dict(mean_D_bp=float(D.mean() * 1e4), sd_R=float(s['R'].std(ddof=1)),
               sd_meanr=float(s['mean_r'].std(ddof=1)),
               frac_below_1=float((s['rate'] < 1.0).mean()),
               tie_rate=float(tie.mean()), fill_rate=float(s['filled'].mean()),
               anchor_bp=float((s['R'].mean() - 1) * 1e4),
               keep=s['keep_rate'], n=len(s['R']))
    if verbose:
        print('--- %s  (n=%d, 생존 %.3f)' % (label, out['n'], out['keep']))
        for k in ('mean_D_bp', 'sd_R', 'sd_meanr', 'frac_below_1',
                  'tie_rate', 'fill_rate'):
            v, tgt = out[k], TARGET[k]
            ok = 'ok' if abs(v - tgt) <= max(abs(tgt) * 0.10, 1e-4) else '<-- 불일치'
            print('   %-14s %11.6f   목표 %11.6f   %s' % (k, v, tgt, ok))
        print('   %-14s %11.6f' % ('anchor_bp', out['anchor_bp']))
    return out


if __name__ == '__main__':
    N = 120000
    print('통과 기준 1: 관측 필터를 켰을 때만 mean(D) ~ -2.0 bp 가 나와야 한다\n')
    a = report(simulate(N, apply_007_filter=False, seed=1), '필터 끔 (무조건부)')
    print()
    b = report(simulate(N, apply_007_filter=True, seed=1), '필터 켬 (007)')
    print('\n=== 통과 기준 5: 앵커 대조 ===')
    print('  필터 끔 %+.3f bp  (목표 %+.2f)'
          % (a['anchor_bp'], TARGET['anchor_unfiltered_bp']))
    print('  필터 켬 %+.3f bp  (목표 %+.2f)'
          % (b['anchor_bp'], TARGET['anchor_filtered_bp']))
    print('  차이    %+.3f bp  (목표 %+.2f)'
          % (b['anchor_bp'] - a['anchor_bp'],
             TARGET['anchor_filtered_bp'] - TARGET['anchor_unfiltered_bp']))

    # 역산: D = -2.0 bp 를 만들려면 탈락률이 얼마여야 하나
    print('\n=== 🔴 역산: 콜라이더 설명이 맞다면 유찰률이 얼마여야 하나 ===')
    print('  %-10s %8s %12s %12s' % ('투찰산포', '생존율', 'mean_D_bp', '앵커 bp'))
    for bs in (0.020, 0.012, 0.008, 0.006, 0.005, 0.004, 0.003):
        s = simulate(N, apply_007_filter=True, seed=2, bid_scale=bs)
        r = report(s, '', verbose=False)
        mark = '  <-- 목표' if abs(r['mean_D_bp'] + 2.0) < 0.25 else ''
        print('  %-10.3f %8.4f %12.4f %12.4f%s'
              % (bs, r['keep'], r['mean_D_bp'], r['anchor_bp'], mark))
    print('  설계문서 8-5: 우리는 공고의 92.9% 만 갖고 있다 -> 유찰률 <= 7.1%')
