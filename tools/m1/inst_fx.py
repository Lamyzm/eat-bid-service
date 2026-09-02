# -*- coding: utf-8 -*-
"""기관을 F_X 층에 넣는다 (M3 수축).  team-lead 지시 ③.

가설: 같은 학교가 같은 공고를 반복하고 **공급사 집합이 안정적**이라면
      그 회차 경쟁자들의 x 가 닮는다. 그게 곧 회차 내 상관이고,
      기관으로 조건화하면 "상관"이 아니라 **빠진 층**이 된다.

형태 — 위치 이동(location shift).  🔴 기관 CDF 를 직접 쓰지 않는다:
    기관 CDF 는 그 기관의 여러 N 을 뭉갠다 = 우리가 쫓는 그 결함을 되넣는 것.
    ⟹ N 조건부 형태는 그대로 두고 기관은 **평행이동**만 시킨다.
        F_X(v | N, g) = F_N(v − δ_g)

M3 수축 (경험적 베이즈):
    δ_g = m_g/(m_g+κ) · mean_a( r̄_a )     r = x − m(N),  m_g = 기관 g 의 회차 수
    κ 를 TUNE 에서 학습한다.  κ→∞ 가 기준선(이동 없음)이다
    🔴 콜드스타트(학습기에 없던 기관) → δ=0 = 전역.  자동으로 그렇게 된다

⚠ δ 는 **학습기(ym≤202512)에서만** 추정하고 TUNE 에서 평가한다.
⚠ 목적함수는 저N(N<30) Brier.  전역은 고N 이 98% 지분이라 못 쓴다
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K

H = 0.02                                   # 두 목적함수 모두 이 값을 골랐다

AS = K.AS
purr = AS['purr']
_ai = {b: i for i, b in enumerate(AS['bid_id'])}
_k = np.array([_ai.get(b, -1) for b in K.XC['bid_id']])
INST = np.where(_k >= 0, purr[np.clip(_k, 0, None)], '')   # 회차별 기관 코드
IU, IIDX = np.unique(INST, return_inverse=True)
print('기관 %d 개 · 회차 %d' % (len(IU), len(INST)))

# --- m(N): 정확한 N 에서의 x **중앙값** (학습기, 커널 h) --------------------------
# 🔴 평균을 못 쓴다: x 에 데이터 오류가 0.13% 있다 (x가 1e-6 이나 99256).
#    CDF 는 꼬리 질량으로 흡수하지만 평균은 파괴된다.  중앙값·대역 제한으로 간다.
BAND = (K.x >= 0.94) & (K.x <= 1.10)          # 98.77%
_tb = K.TRAIN[K.aid] & BAND
_mn, _mc = {}, {}
for n in np.unique(K.nbid[K.TRAIN]):
    q = _tb & (K.nbid[K.aid] == n)
    if q.sum() < 50:
        continue
    _mn[int(n)] = float(np.median(K.x[q]))
    _mc[int(n)] = float(q.sum())
MNS = np.array(sorted(_mn), float)
MEAN = np.array([_mn[int(n)] for n in MNS])
MCN = np.array([_mc[int(n)] for n in MNS])


def m_at(nv):
    d = np.abs(np.log(np.asarray(nv, float))[:, None] - np.log(MNS)[None, :])
    w = MCN[None, :] * np.exp(-d / H)
    w /= w.sum(1, keepdims=True)
    return w @ MEAN


# --- 회차별 잔차 중앙값 r̄_a (대역 내 투찰만) -------------------------------------
NB = np.maximum(K.nbid, 1)
mN = m_at(NB)
_ord = np.lexsort((K.x, K.aid))                      # 회차별 정렬 → 중앙값
_ba = K.aid[_ord][BAND[_ord]]
_bx = K.x[_ord][BAND[_ord]]
_cnt = np.bincount(_ba, minlength=len(NB))
_st = np.concatenate([[0], np.cumsum(_cnt)[:-1]])
_ok = _cnt > 0
_med = np.zeros(len(NB))
_lo = _st[_ok] + (_cnt[_ok] - 1) // 2
_hi2 = _st[_ok] + _cnt[_ok] // 2
_med[_ok] = 0.5 * (_bx[_lo] + _bx[_hi2])
RBAR = np.where(_ok, _med - mN, 0.0)

_tr = K.TRAIN & _ok
_s = np.bincount(IIDX[_tr], weights=RBAR[_tr], minlength=len(IU))
_m = np.bincount(IIDX[_tr], minlength=len(IU)).astype(float)
print('학습기 회차를 가진 기관 %d · 중앙 회차수 %d · sd(r̄_a) %.5f'
      % ((_m > 0).sum(), int(np.median(_m[_m > 0])), RBAR[_tr].std()))


def delta(kappa):
    if not np.isfinite(kappa):
        return np.zeros(len(IU))
    raw = np.where(_m > 0, _s / np.maximum(_m, 1), 0.0)
    return (_m / (_m + kappa)) * raw


# --- 평가 ---------------------------------------------------------------------
XI, AI, NT, ACT = K.XI, K.AI, K.NT, K.ACT
DIDX = IIDX[AI]
COLD = (_m[DIDX] == 0)
print('평가 투찰 %d · 콜드스타트(신규 기관) %.2f%%' % (len(XI), 100 * COLD.mean()))

_F = {int(n): K.Fx_at([n], H)[0] for n in np.unique(NT)}


def pwin_d(xv, Fx, nvec, dvec, chunk=2000):
    """F_X(v|N,g) = F_N(v−δ_g).  질의점을 δ 만큼 밀면 된다."""
    out = np.empty(len(xv))
    for a in range(0, len(xv), chunk):
        v = xv[a:a + chunk]
        d = dvec[a:a + chunk]
        nn = np.maximum(np.asarray(nvec[a:a + chunk], float) - 1, 0)[:, None]   # 🔴 지수는 경쟁자 수 = N−1
        Fv = np.interp(v - d, K.XGRID, Fx)[:, None]
        rq = K._MID[None, :] - d[:, None]
        Fr = np.interp(rq.ravel(), K.XGRID, Fx).reshape(rq.shape)
        surv = np.clip(1 - Fv + Fr, 0, 1) ** nn
        out[a:a + chunk] = (K._W[None, :] * surv * (K._MID[None, :] <= v[:, None])).sum(1)
    return out


def predict(kappa):
    dl = delta(kappa)[DIDX]
    out = np.zeros(len(XI))
    for n, q in K.GRP.items():
        out[q] = pwin_d(XI[q], _F[n], NT[q], dl[q])
    return out


if __name__ == '__main__':
    print('\nδ 크기 (κ 별) — sd(R)=0.0076 이 비교 기준이다')
    for kp in (0, 1, 3, 10, 30, 100):
        d = delta(kp)[DIDX]
        print('  κ=%-5s sd(δ) %.5f   |δ| p90 %.5f' % (kp, d.std(), np.percentile(np.abs(d), 90)))

    print('\n대역 %s' % ' '.join('%d-%d' % b for b in K.BANDS))
    print('=== 기관 위치이동 — κ 학습 (목적함수: 저N Brier) ===')
    res = {}
    res[np.inf] = K.report(predict(np.inf), '기준선 (이동 없음)')
    for kp in (0, 1, 3, 10, 30, 100):
        res[kp] = K.report(predict(kp), 'κ=%g' % kp)
    kl = min(res, key=lambda z: res[z][1])
    print('\n  🔴 저N Brier 최소 κ=%g  (기준선 저N %.6f → %.6f)'
          % (kl, res[np.inf][1], res[kl][1]))
