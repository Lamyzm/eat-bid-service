# -*- coding: utf-8 -*-
"""모듈 책임: CHC_YN 을 DRAW_NO 득표로 재구성한다 — 규칙과 동점 처리를 전수로 확정한다.

왜: R = mean(뽑힌 4개) 는 이미 99.96% 확인됐다. 그러면 남는 미지수는
**"어느 4개가 뽑히는가"** 하나다. 그게 득표로 결정된다면 메커니즘에 미지수가 없다.

09 에서 단순히 "무득표 상위 4개" 로 맞춰보니 77.3% 밖에 안 맞았고
**회차의 49.7% 가 4위-5위 동점**이었다. 동점이 이렇게 흔하면 tie-break 규칙이
메커니즘의 절반이다. 여기서 갈라 본다.

  * 표 집계에 철회자(WITHDRAWAL_YN='Y')를 넣는가 빼는가
  * 동점을 어떻게 깨는가 — 낮은 번호 우선인가, 재추첨인가
    귀무 "재추첨(균등)" 아래 기대 일치율을 정확히 계산해서 실측과 겨룬다.
"""
from __future__ import annotations

import os
from collections import Counter
from math import comb

import numpy as np

MECH = os.environ.get("EATBID_MECH_DIR", r"F:/Project/eat-bid/data/mechanism")


def analyze(tag, v, chosen):
    n = v.shape[0]
    # 4위 득표선 s4: 내림차순 4번째 값
    srt = -np.sort(-v, axis=1)
    s4 = srt[:, 3]
    above = (v > s4[:, None])            # 확실히 들어가는 슬롯
    equal = (v == s4[:, None])           # 경계선에 걸린 슬롯
    n_above = above.sum(axis=1)
    n_equal = equal.sum(axis=1)
    slots_left = 4 - n_above             # 경계선에서 뽑아야 할 개수
    tie = n_equal > slots_left           # 동점 발생

    ok_above = (chosen & above).sum(axis=1) == n_above       # 확실한 것은 다 뽑혔나
    ok_none = ((chosen & ~above & ~equal).sum(axis=1) == 0)  # 미달은 안 뽑혔나
    consistent = ok_above & ok_none                          # 득표 규칙과 모순 없음

    print()
    print("=" * 84)
    print(tag)
    print("=" * 84)
    print("  회차 %d" % n)
    print("  동점 없음(4위>5위) %.3f%%   동점 %.3f%%" % (
        100 * (~tie).mean(), 100 * tie.mean()))
    print("  득표 규칙과 **모순 없음** (상위는 전부 뽑히고 미달은 하나도 안 뽑힘)")
    print("     전체            %.3f%%" % (100 * consistent.mean()))
    print("     동점 없는 회차   %.3f%%   ← 여기서 100%% 가 아니면 규칙 자체가 틀린 것" % (
        100 * consistent[~tie].mean()))
    print("     동점 회차        %.3f%%" % (100 * consistent[tie].mean()))

    # 동점을 재추첨(균등)으로 깬다는 귀무 아래 기대 일치율
    #   경계선 n_equal 개 중 slots_left 개를 균등 선택 -> 특정 조합이 맞을 확률 1/C(n_equal, slots_left)
    t = tie & consistent
    ne, sl = n_equal[t], slots_left[t]
    exp = np.array([1.0 / comb(int(a), int(b)) for a, b in zip(ne, sl)])
    # 실제로 낮은 번호 우선이었나
    idx = np.arange(15)
    low_ok = np.zeros(t.sum(), dtype=bool)
    eq_t, ch_t = equal[t], chosen[t]
    for i in range(t.sum()):
        cand = idx[eq_t[i]]
        picked = idx[eq_t[i] & ch_t[i]]
        low_ok[i] = len(picked) == sl[i] and set(picked) == set(cand[: sl[i]])
    print()
    print("  동점 깨는 규칙 (모순 없는 동점 회차 n=%d)" % t.sum())
    print("     '낮은 번호 우선' 실측 일치  %.3f%%" % (100 * low_ok.mean()))
    print("     '재추첨(균등)' 귀무 기대     %.3f%%   ← 우연히 낮은 쪽이 뽑힐 확률" % (
        100 * exp.mean()))
    print("     경계선 인원 분포:", Counter(zip(ne.tolist(), sl.tolist())).most_common(6))
    z = (low_ok.mean() - exp.mean()) / (exp.std(ddof=1) / np.sqrt(len(exp)) + 1e-12)
    print("     차이 %+.3f%%p" % (100 * (low_ok.mean() - exp.mean())))
    return consistent, tie


def main():
    p = np.load(os.path.join(MECH, "plist.npz"))
    b = np.load(os.path.join(MECH, "bids.npz"))
    common, ip, ib = np.intersect1d(p["bid_id"], b["bid_id"], return_indices=True)
    chosen = p["chosen"][ip]
    print("조인 %d 회차" % len(common))
    print("  투표자 수(철회 제외) 중앙 %d · 입찰자 수 중앙 %d · 철회 있는 회차 %.2f%%" % (
        np.median(b["nvoter"][ib]), np.median(b["nbid"][ib]),
        100 * (b["nwithdraw"][ib] > 0).mean()))

    c1, t1 = analyze("① 철회자 표 제외", b["votes"][ib].astype(np.int32), chosen)
    c2, t2 = analyze("② 철회자 표 포함", b["votes_all"][ib].astype(np.int32), chosen)

    print()
    print("=" * 84)
    print("판정")
    print("=" * 84)
    print("  철회자 표를 %s 쪽이 규칙과 덜 모순된다 (동점 없는 회차 기준 %.3f%% vs %.3f%%)" % (
        "포함하는" if c2[~t2].mean() > c1[~t1].mean() else "제외하는",
        100 * c2[~t2].mean(), 100 * c1[~t1].mean()))


if __name__ == "__main__":
    main()
