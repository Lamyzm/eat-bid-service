# -*- coding: utf-8 -*-
"""승률 모형의 뿌리 — `bidlevel.npz` 직행. **나이 불변 양만 쓴다.**

기록 지연이 확인됐다(개정 31): 철회 플래그가 ~18개월에 걸쳐 쌓인다.
`2026-07·08` 은 517,202 투찰에서 정확히 `0.0000%` 다.

```
✅ 나이 불변   BID_CNT(=off) · 전 투찰의 x · is_recorded_winner · R
❌ 나이 의존   wd 플래그 · 생존자 수 · 생존자 행집합 · 규칙 유도 낙찰자
```
🔴 **이 모듈은 나이 의존 양을 하나도 안 쓴다.** `wd` 는 진단용으로만 노출하고
   `assert_wd_unused()` 가 그걸 *실증*한다 — `wd` 를 섞어도 출력이 비트 단위로 같아야 한다.

정의를 여기 한 곳에 가둔다 (규율 30):
```
N     = off = BID_CNT = 개찰 시점 풀.  지수는 N−1 (경쟁자 수)
ACT   = is_recorded_winner.  8개 파일이 각자 lexsort 로 만들던 걸 여기서 한 번만 만든다
F_X   = 전 투찰의 x (철회 포함)
```
"""
from __future__ import annotations

import numpy as np

from fr import FR

SOURCE = 'bidlevel'                 # 🔴 개봉 게이트가 읽는다
ACT_FROM_RECORD = True              # 🔴 개봉 게이트가 읽는다

BL = np.load(r'F:/Project/eat-bid/data/mechanism/bidlevel.npz', allow_pickle=True)
AS = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)

# npz 멤버는 접근마다 압축 해제된다 — 전부 여기서 한 번만 푼다
x = BL['x'].astype(np.float64)
cnt = BL['off'].astype(np.int64)            # = BID_CNT.  모든 월에서 plist.bid_cnt 와 100% 일치
_WIN = BL['is_recorded_winner']
_WD_DIAG = BL['wd']                         # ⚠ 진단 전용. 모형 경로에서 쓰지 않는다
bid_id = BL['bid_id']

aid = np.repeat(np.arange(len(cnt)), cnt)
nbid = cnt                                  # 🔴 N = 풀 수.  생존자 수가 아니다
NPOOL = nbid
NOBS = nbid - np.bincount(aid, weights=_WD_DIAG.astype(np.int64),
                          minlength=len(cnt)).astype(np.int64)   # 진단용

# --- asof 조인: R · ym · α 규칙 재료 -------------------------------------------
_ai = {b: i for i, b in enumerate(AS['bid_id'])}
_k = np.array([_ai.get(b, -1) for b in bid_id])
OK_A = _k >= 0
_kc = np.clip(_k, 0, None)
ym = np.where(OK_A, AS['ym'][_kc], -1).astype(int)
R = np.where(OK_A, AS['R'][_kc], np.nan)
RSUS = np.where(OK_A, AS['R_suspect'][_kc], True)
_floor = np.where(OK_A, AS['floor'][_kc], np.nan)
_bgng = np.where(OK_A, AS['bgng'][_kc], np.nan)
ALPHA2 = (_floor == 88) & (_bgng < 2e7)     # fr.alpha_of 규칙. True 면 α=0.02

# 🔴 조인 커버리지 단언 (규율 24) — 암묵으로 두지 않는다
_n_nojoin = int((~OK_A).sum())
_n_rsus = int((OK_A & RSUS).sum())
print('bidlevel 회차 %d · 투찰 %d' % (len(cnt), len(x)))
print('🔴 R 조인 실패 %d 회차 (%.4f%%) — 버린다. 값을 채우지 않는다'
      % (_n_nojoin, 100 * _n_nojoin / len(cnt)))
print('🔴 R_suspect %d 회차 (%.4f%%) — 승률 계산에서 **제외**한다 (R 오염 91건 계열)'
      % (_n_rsus, 100 * _n_rsus / len(cnt)))

_hs = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([_hs.get(b, '') for b in bid_id])

USABLE = OK_A & ~RSUS & (nbid >= 3)
TRAIN = USABLE & (ym >= 0) & (ym <= 202512)
TUNE = USABLE & (split == 'TUNE')
EVALUABLE = USABLE

# --- ACT: 기록 낙찰자. 🔴 여기서 한 번만 만든다 ----------------------------------
ACT_ALL = _WIN.astype(np.float64)
_nwin = np.bincount(aid, weights=ACT_ALL, minlength=len(cnt))
assert (_nwin[USABLE] == 1).all(), '회차당 낙찰자가 1명이 아니다 — 술어 위반'

XGRID = np.linspace(0.94, 1.10, 1601)

# --- N 별 경험 CDF (학습기, 전 투찰) --------------------------------------------
_tb = TRAIN[aid]
_emp, _cn = {}, {}
for n in np.unique(nbid[TRAIN]):
    q = _tb & (nbid[aid] == n)
    c = int(q.sum())
    if c < 50:
        continue
    v = np.sort(x[q])
    _emp[int(n)] = np.searchsorted(v, XGRID, side='right') / len(v)
    _cn[int(n)] = float(c)
NS = np.array(sorted(_emp), float)
EMP = np.stack([_emp[int(n)] for n in NS])
CN = np.array([_cn[int(n)] for n in NS])
LOGNS = np.log(NS)


def Fx_at(nvals, h):
    """F_X(·|n) — 임의의 n 에서. 경계 없음."""
    d = np.abs(np.log(np.asarray(nvals, float))[:, None] - LOGNS[None, :])
    w = CN[None, :] * np.exp(-d / max(h, 1e-6))
    w /= w.sum(1, keepdims=True)
    return w @ EMP


_FR = FR(n=200000, seed=2, nbin=201)
_MID, _MID2 = _FR.mid[0.03], _FR.mid[0.02]
_W = _FR.pdf[0.03] * np.diff(_FR.edges[0.03])
_W2 = _FR.pdf[0.02] * np.diff(_FR.edges[0.02])

# --- 평가 대상 (TUNE 전수) ------------------------------------------------------
_sel = TUNE[aid]
XI, AI = x[_sel], aid[_sel]
NT = nbid[AI]
ACT = ACT_ALL[_sel]
UNQ = np.unique(NT)
GRP = {int(n): np.flatnonzero(NT == n) for n in UNQ}
print('학습 %d 회차 · TUNE %d 회차 · 평가 투찰 %d · 실제 낙찰률 %.5f'
      % (TRAIN.sum(), TUNE.sum(), len(XI), ACT.mean()))


def pwin_v(xv, Fx, nvec, chunk=4000, a2=None):
    """P(승|x,N) = ∫ w(r)·1{r≤x}·(1−F(x)+F(r))^(N−1) dr.  지수는 경쟁자 수."""
    out = np.empty(len(xv))
    Fr, Fr2 = np.interp(_MID, XGRID, Fx), np.interp(_MID2, XGRID, Fx)
    for a in range(0, len(xv), chunk):
        v = xv[a:a + chunk]
        nn = np.maximum(np.asarray(nvec[a:a + chunk], float) - 1, 0)[:, None]
        for mid, wt, fr_, is2 in ((_MID, _W, Fr, False), (_MID2, _W2, Fr2, True)):
            if a2 is None:
                if is2:
                    continue
                idx = np.arange(len(v))
            else:
                s = a2[a:a + chunk]
                idx = np.flatnonzero(s if is2 else ~s)
                if len(idx) == 0:
                    continue
            vv = v[idx]
            Fv = np.interp(vv, XGRID, Fx)[:, None]
            surv = np.clip(1 - Fv + fr_[None, :], 0, 1) ** nn[idx]
            out[a + idx] = (wt[None, :] * surv * (mid[None, :] <= vv[:, None])).sum(1)
    return out


def predict(h, use_alpha=True):
    F = Fx_at(UNQ, h)
    A2 = ALPHA2[AI] if use_alpha else None
    out = np.zeros(len(XI))
    for j, n in enumerate(UNQ):
        q = GRP[int(n)]
        out[q] = pwin_v(XI[q], F[j], NT[q], a2=None if A2 is None else A2[q])
    return out


def cluster_se(d, a):
    """회차 군집 SE — 회차당 낙찰자가 정확히 1명이라 회차 내 상관이 강하다."""
    m = len(d)
    if m == 0:
        return np.nan
    D = d.mean()
    _, inv = np.unique(a, return_inverse=True)
    S = np.bincount(inv, weights=d - D)
    return float(np.sqrt((S ** 2).sum()) / m)


BANDS = [(3, 4), (5, 9), (10, 29), (30, 59), (60, 99), (100, 10 ** 9)]


def report(p, label, quiet=False):
    rows = []
    for lo, hi in BANDS:
        q = (NT >= lo) & (NT <= hi)
        if q.sum() < 500:
            rows.append((np.nan,) * 4)
            continue
        a = ACT[q].mean()
        d = p[q] - ACT[q]
        rows.append((100 * d.mean() / a, 100 * cluster_se(d, AI[q]) / a,
                     int(q.sum()), len(np.unique(AI[q]))))
    lo30 = NT < 30
    bg = float(np.mean((p - ACT) ** 2))
    bl = float(np.mean((p[lo30] - ACT[lo30]) ** 2))
    if not quiet:
        print('  %-22s Brier 전역 %.6f  저N %.6f | %s'
              % (label, bg, bl, ' '.join('%6.1f±%.1f%%' % (r[0], r[1]) for r in rows)))
    return bg, bl, rows


def assert_wd_unused(h=0.02):
    """🔴 상시 단언 — 승률 경로가 `wd` 를 안 읽는다는 것을 *실증*한다.

    `wd` 를 무작위로 섞고 파이프라인을 다시 태워 출력이 **비트 단위로** 같은지 본다.
    어디선가 읽고 있으면 달라진다.  주석이 아니라 검정이다.
    """
    global _WD_DIAG, NOBS
    base = predict(h)
    keep_wd, keep_nobs = _WD_DIAG, NOBS
    rng = np.random.default_rng(0)
    _WD_DIAG = rng.permutation(_WD_DIAG)
    NOBS = nbid - np.bincount(aid, weights=_WD_DIAG.astype(np.int64),
                              minlength=len(cnt)).astype(np.int64)
    same = np.array_equal(base, predict(h))
    _WD_DIAG, NOBS = keep_wd, keep_nobs
    print('🔴 wd 미사용 단언: wd 를 섞어도 출력 동일 = %s' % same)
    return same


if __name__ == '__main__':
    assert_wd_unused()
    print('\n대역 %s' % ' '.join('%d-%d' % (a, min(b, 364)) for a, b in BANDS))
    report(predict(0.02), 'bidlevel · N=BID_CNT · ACT=기록')
