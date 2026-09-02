# -*- coding: utf-8 -*-
"""4번 — `N̂` 을 **분포로** 주변화하고 Murphy 분해로 회수율을 낸다.

세 사다리. 셋 다 같은 투찰에서, 같은 `F_X(·|N)` 과 같은 지수(`N−1`)로.

    (1) 천장   P(승|x, N)                     정확한 N 을 안다
    (3) N̂     Σ_b P̂(b|공고) Σ_{N∈b} P(N|b) P(승|x,N)
    (2) 바닥   Σ_N P(N) P(승|x,N)              공고 정보를 안 쓴다
              🔴 평균 N 을 꽂지 않는다. 그게 다섯 번째 축을 분모에 넣는 것이다

🔴 회수율은 **보정이 아니라 분해능**으로 잰다 (team-lead 정정):
    제대로 주변화한 (2)는 정의상 P(승|x) 라 **편향이 0** 이다. 최소인 건 분해능이다.
    ⟹ 회수율 = (res₃ − res₂) / (res₁ − res₂)

⚠ Murphy: Brier = rel − res + unc.  **항등식이 수치적으로 닫히는지 확인한다** (실패 12).
⚠ `nhat_tune2.npz` 가 정본이다 (ALPHA=2 · T=1.0 · 5점 격자에서 선택 · 창 202601-202605).
⚠ `TUNE` 에서만. 봉인 미접촉.
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K

NH = np.load(r'C:/Users/kano/AppData/Local/Temp/claude/C--Users-kano'
             r'/f2fa05d3-8165-4658-94f7-75535b0fb45e/scratchpad/nhat_tune2.npz',
             allow_pickle=True)
EDGES = [2, 5, 10, 30, 100]                # 버킷 1 / 2-4 / 5-9 / 10-29 / 30-99 / 100+
H = 0.02

# --- N=1,2 까지 포함한 F_X 격자 (기존 TRAIN 은 nbid>=3 필터가 있다) ------------------
TR2 = (K.ym <= 202512)
tb = TR2[K.aid]
emp, cn = {}, {}
for n in np.unique(K.nbid[TR2]):
    q = tb & (K.nbid[K.aid] == n)
    if q.sum() < 50:
        continue
    v = np.sort(K.x[q])
    emp[int(n)] = np.searchsorted(v, K.XGRID, side='right') / len(v)
    cn[int(n)] = float(q.sum())
NS = np.array(sorted(emp), float)
EMP = np.stack([emp[int(n)] for n in NS])
CN = np.array([cn[int(n)] for n in NS])


def Fx_at(nv):
    d = np.abs(np.log(np.asarray(nv, float))[:, None] - np.log(NS)[None, :])
    w = CN[None, :] * np.exp(-d / H)
    w /= w.sum(1, keepdims=True)
    return w @ EMP


# --- P(승 | x, N) 을 x 격자 × N 격자 조견표로 --------------------------------------
NKN = np.arange(1, int(K.nbid.max()) + 1)
XG = K.XGRID
F_ALL = Fx_at(NKN)
# 🔴 α 가 회차마다 다르므로 조견표를 α 별로 둘 만든다 (α=0.02 회차 2.96%)
TABS = np.empty((2, len(NKN), len(XG)))
for a2 in (0, 1):
    for j, n in enumerate(NKN):
        TABS[a2, j] = K.pwin_v(XG, F_ALL[j], np.full(len(XG), n, float),
                               a2=np.full(len(XG), bool(a2)))
TAB = TABS[0]
print('조견표 2 α × %d N × %d x' % TAB.shape)

# --- 평가 대상: nhat 창의 TUNE 투찰 전부 ------------------------------------------
bi = {b: i for i, b in enumerate(K.XC['bid_id'])}
ki = np.array([bi.get(b, -1) for b in NH['bid_id']])
assert (ki >= 0).all()
P6 = NH['P']
Pb = np.zeros((len(K.R), 6))
Pb[ki] = P6
has = np.zeros(len(K.R), bool)
has[ki] = True

sel = has[K.aid]
XI, AI = K.x[sel], K.aid[sel]
NT = K.nbid[AI]
v = K.x >= K.R[K.aid]
xv = np.where(v, K.x, 1e9)
o = np.lexsort((xv, K.aid))
f = np.ones(len(K.x), bool)
f[1:] = K.aid[o][1:] != K.aid[o][:-1]
w_ = np.zeros(len(K.x), bool)
wi = o[f]
w_[wi] = v[wi]
ACT = w_[sel].astype(float)
print('평가 투찰 %d · 회차 %d · 실제 낙찰률 %.4f'
      % (len(XI), has.sum(), ACT.mean()))

# --- 세 예측기 -----------------------------------------------------------------
IX = np.clip(np.searchsorted(XG, XI) - 1, 0, len(XG) - 2)
fr = (XI - XG[IX]) / (XG[IX + 1] - XG[IX])
fr = np.clip(fr, 0, 1)


def curve_to_p(cc):
    """조견 곡선 cc[α] 를 각 투찰의 x·α 에서 선형보간."""
    c = cc[A2, IX] if cc.ndim == 2 else cc[IX]
    d = cc[A2, IX + 1] if cc.ndim == 2 else cc[IX + 1]
    return c * (1 - fr) + d * fr


A2 = K.ALPHA2[AI].astype(int)                 # 투찰별: 그 회차의 α 가 0.02 인가

# (1) 천장 — 정확한 N
P1 = np.empty(len(XI))
for n in np.unique(NT):
    for a2 in (0, 1):
        q = (NT == n) & (A2 == a2)
        if not q.any():
            continue
        c = TABS[a2, n - 1]
        P1[q] = c[IX[q]] * (1 - fr[q]) + c[IX[q] + 1] * fr[q]

# 학습기의 N 분포 (회차 단위)
nb_tr = K.nbid[TR2]
wA = np.bincount(nb_tr, minlength=len(NKN) + 1)[1:].astype(float)
wA /= wA.sum()

# 🔴 평가 기준집합이 **투찰**이다. 회차 하나가 N 번 들어간다 ⟹ 크기 편향을 걸어야 한다.
#    P(N | 무작위 투찰) ∝ N · P(N | 무작위 회차)
#    (2) 의 rel 이 0 이 되는지가 이게 맞는지의 검사다 — 정의상 P(승|x) 여야 한다
#    ⚠ 제품 예측기는 이 보정을 **쓰면 안 된다**. 거기선 회차가 지정돼 있어 기준집합이 다르다
wB = wA * NKN
wB /= wB.sum()
C2 = np.stack([wB @ TABS[0], wB @ TABS[1]])
P2 = curve_to_p(C2)

# (3) N̂ — 버킷 안에서도 같은 기준집합. 그리고 버킷 확률 자체도 크기 편향
bk = np.digitize(NKN, EDGES)
C3 = np.zeros((6, 2, len(XG)))
EN = np.zeros(6)
for b in range(6):
    m = bk == b
    ww = wB[m] / wB[m].sum()
    C3[b] = np.stack([ww @ TABS[0][m], ww @ TABS[1][m]])
    EN[b] = (wA[m] / wA[m].sum() * NKN[m]).sum()      # 회차 단위 E[N|b]
PbB = Pb * EN[None, :]
PbB /= np.maximum(PbB.sum(1, keepdims=True), 1e-12)
P3 = (PbB[AI] * np.stack([curve_to_p(C3[b]) for b in range(6)], 1)).sum(1)


# --- Murphy -------------------------------------------------------------------
def murphy(p, y, nb=200):
    e = np.linspace(0, 1, nb + 1)
    b = np.clip(np.digitize(p, e[1:-1]), 0, nb - 1)
    n = np.bincount(b, minlength=nb).astype(float)
    sp = np.bincount(b, weights=p, minlength=nb)
    sy = np.bincount(b, weights=y, minlength=nb)
    m = n > 0
    N = len(y)
    ybar = y.mean()
    rel = (n[m] * (sp[m] / n[m] - sy[m] / n[m]) ** 2).sum() / N
    res = (n[m] * (sy[m] / n[m] - ybar) ** 2).sum() / N
    unc = ybar * (1 - ybar)
    return rel, res, unc, float(np.mean((p - y) ** 2))


if __name__ == '__main__':
    print('\n=== Murphy 분해 (200 bin) — Brier = rel − res + unc ===')
    print('%-22s %10s %10s %10s %10s %12s'
          % ('', 'rel', 'res', 'unc', 'Brier', '항등식 잔차'))
    out = {}
    for lab, p in [('(1) 천장 · 정확한 N', P1), ('(3) N̂ 분포 주변화', P3),
                   ('(2) 바닥 · 무조건부', P2)]:
        rel, res, unc, br = murphy(p, ACT)
        out[lab[1]] = (rel, res, unc, br)
        print('%-22s %10.6f %10.6f %10.6f %10.6f %12.2e'
              % (lab, rel, res, unc, br, br - (rel - res + unc)))
    r1, r3, r2 = out['1'][1], out['3'][1], out['2'][1]
    print('\n  🔴 분해능 회수율 (res₃ − res₂)/(res₁ − res₂) = %.4f' % ((r3 - r2) / (r1 - r2)))
    print('     Brier 기준 회수율                        = %.4f'
          % ((out['2'][3] - out['3'][3]) / (out['2'][3] - out['1'][3])))
    print('\n  ⚠ (2) 의 rel 이 ~0 이어야 한다 — 제대로 주변화하면 정의상 P(승|x) 다.')

    print('\n=== 층별 미보정 (N 대역) — 셋 다 ===')
    K.NT, K.AI, K.ACT = NT, AI, ACT
    print('대역 %s' % ' '.join('%d-%d' % b for b in K.BANDS))
    for lab, p in [('(1) 천장', P1), ('(3) N̂', P3), ('(2) 바닥', P2)]:
        K.report(p, lab)
