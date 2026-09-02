# -*- coding: utf-8 -*-
"""3번 — F_X 를 정확한 N 으로 조건부화 + M3 수축량 학습.  TUNE 에서만.

진단(§0-K·경계 점프): F_X 를 N 버킷으로 풀링하면 비선형성 **안쪽**에서 평균내게 되어
경계마다 −15~−21 %p 편차가 생긴다(N=5·10·30 전부 유의). 정확한 N 으로 조건부화하면
그 편향이 제거된다.

M3: N 하나당 표본이 얇으므로 이웃 N 끼리 부분 풀링한다.
    F_X(·|N) = Σ_N' w(N,N') · F̂_N'      w ∝ n_N' · exp(−|log N' − log N| / h)
    🔴 대역폭 h 는 **학습한다**. 손으로 고르면 같은 인공물을 다른 모양으로 넣는 것이다.
    (team-lead 사전 승인: TUNE 에서 하이퍼파라미터를 맞추는 건 정상이고 봉인을 안 건드린다)

🔴 그리고 (2) 무조건부 바닥의 정의를 고쳤다 (team-lead 정정):
    ❌ P(승 | x, N̄)              평균 N 을 꽂는 것 = 점추정 = 다섯 번째 축을 분모에 넣는 것
                                  바닥을 나쁘게 잡을수록 회수율이 1 로 수렴한다
    ✅ Σ_N P(N) · P(승 | x, N)    무조건부 주변분포로 주변화
                                  "공고 정보를 안 쓴다"이지 "N 을 안 쓴다"가 아니다

    ⟹ 제대로 주변화한 (2)는 **편향이 0** 이다. 분해능만 최소다.
    ⟹ 3번은 *편향*을 없애고 4번은 *분해능*을 잰다. 한 숫자에 섞으면 안 된다.
"""
from __future__ import annotations

import numpy as np

from fr import FR
from m1 import M1

XC = np.load(r'F:/Project/eat-bid/data/mechanism/xcap.npz', allow_pickle=True)
AS = np.load(r'F:/Project/eat-bid/data/mechanism/asof.npz', allow_pickle=True)
HO = np.load(r'F:/Project/eat-bid/data/mechanism/holdout.npz', allow_pickle=True)

x, cnt, R, nbid = (XC['x'].astype(np.float64), XC['off'], XC['R'],
                   XC['nbid'].astype(int))
bi = {b: i for i, b in enumerate(AS['bid_id'])}
k = np.array([bi.get(b, -1) for b in XC['bid_id']])
ym = np.where(k >= 0, AS['ym'][np.clip(k, 0, None)], -1).astype(int)
hi = {b: s for b, s in zip(HO['bid_id'], HO['split'])}
split = np.array([hi.get(b, '') for b in XC['bid_id']])

aid = np.repeat(np.arange(len(R)), cnt)
TRAIN = (ym <= 202512) & (nbid >= 3)
TUNE = (split == 'TUNE') & (nbid >= 3)
print('학습 %d 회차 · TUNE %d 회차   (HOLD 는 열지 않는다)'
      % (TRAIN.sum(), TUNE.sum()))

XGRID = np.linspace(0.94, 1.10, 1601)
NMAX = 60                                    # N>=NMAX 는 하나로 묶는다 (표본·효과 둘 다 얇다)
ncap = np.minimum(nbid, NMAX)

# --- N 별 경험 CDF (학습 기간) -------------------------------------------------
emp, cntN = {}, {}
tb = TRAIN[aid]
for n in range(3, NMAX + 1):
    q = tb & (ncap[aid] == n)
    if q.sum() < 50:
        continue
    v = np.sort(x[q])
    emp[n] = np.searchsorted(v, XGRID, side='right') / len(v)
    cntN[n] = q.sum()
NS = np.array(sorted(emp))
EMP = np.stack([emp[n] for n in NS])
CN = np.array([cntN[n] for n in NS], float)
print('N 격자 %d 개 (%d~%d) · 최소 표본 %d' % (len(NS), NS[0], NS[-1], CN.min()))


def smooth(h):
    """M3 — 이웃 N 끼리 부분 풀링. h 가 대역폭(로그 N 단위)."""
    d = np.abs(np.log(NS)[:, None] - np.log(NS)[None, :])
    w = CN[None, :] * np.exp(-d / max(h, 1e-6))
    w /= w.sum(1, keepdims=True)
    return w @ EMP


_FR = FR(n=200000, seed=2)
_MID = _FR.mid[0.03]
_W = _FR.pdf[0.03] * np.diff(_FR.edges[0.03])

# 평가 대상 투찰 (TUNE)
_sel = TUNE[aid]
XI, AI = x[_sel], aid[_sel]
NN = ncap[AI]
# 낙찰 여부
_valid = x >= R[aid]
_xv = np.where(_valid, x, 1e9)
_o = np.lexsort((_xv, aid))
_f = np.ones(len(x), bool)
_f[1:] = aid[_o][1:] != aid[_o][:-1]
_win = np.zeros(len(x), bool)
_wi = _o[_f]
_win[_wi] = _valid[_wi]
ACT = _win[_sel]


def pwin(xv, Fx, n, chunk=4000):
    """P(승 | x, N=n)  — 벡터화. Fx 는 XGRID 위의 CDF."""
    out = np.empty(len(xv))
    Fr = np.interp(_MID, XGRID, Fx)                 # (nR,)
    for a in range(0, len(xv), chunk):
        v = xv[a:a + chunk]
        Fv = np.interp(v, XGRID, Fx)[:, None]
        surv = np.clip(1 - Fv + Fr[None, :], 0, 1) ** n
        out[a:a + chunk] = (_W[None, :] * surv * (_MID[None, :] <= v[:, None])).sum(1)
    return out


def predict(F_by_n, marginal=False, pN=None):
    out = np.zeros(len(XI))
    for j, n in enumerate(NS):
        if marginal:
            out += pN[j] * pwin(XI, F_by_n[j], int(n))
        else:
            q = NN == n
            if q.any():
                out[q] = pwin(XI[q], F_by_n[j], int(n))
    return out


def report(p, label):
    b = np.mean((p - ACT) ** 2)
    rows = []
    for lo, hi_ in [(3, 4), (5, 9), (10, 29), (30, NMAX)]:
        q = (NN >= lo) & (NN <= hi_)
        rows.append(100 * (p[q].mean() / ACT[q].mean() - 1) if q.sum() > 500 else np.nan)
    print('  %-22s Brier %.6f   미보정  %s'
          % (label, b, ' '.join('%7.1f%%' % v for v in rows)))
    return b, rows


if __name__ == '__main__':
    print('\n=== 층별 미보정 (TUNE) — N=3-4 / 5-9 / 10-29 / 30+ ===')
    # 기준선: 기존 6버킷 풀링
    from m1 import n_bucket
    BK = n_bucket(NS)
    Fb = np.stack([EMP[BK == BK[j]].T @ (CN[BK == BK[j]] / CN[BK == BK[j]].sum())
                   for j in range(len(NS))])
    report(predict(Fb), '기준선 (6버킷 풀링)')

    print('\n=== M3 대역폭 h 학습 (TUNE 에서) ===')
    best = None
    for h in (0.02, 0.05, 0.10, 0.20, 0.40, 0.80):
        b, _ = report(predict(smooth(h)), 'h=%.2f' % h)
        if best is None or b < best[0]:
            best = (b, h)
    print('\n  🔴 선택 h=%.2f (Brier 최소 %.6f)' % (best[1], best[0]))

    print('\n=== (2) 무조건부 바닥 — Σ_N P(N)·P(승|x,N).  평균 N 을 꽂지 않는다 ===')
    pN = CN / CN.sum()
    report(predict(smooth(best[1]), marginal=True, pN=pN), '(2) 무조건부 주변화')
    print('\n  🔴 (2)는 편향이 0 이어야 한다 (정의상 P(승|x)). 미보정이 ~0 이면 확인이다.')
    print('     (1)↔(2) 격차는 편향이 아니라 **분해능**이다.')
