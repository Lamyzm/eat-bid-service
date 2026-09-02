# -*- coding: utf-8 -*-
"""모듈 책임: 세 사다리를 `N_pool` · `nhat_pool` 로 통일하고 **분해능 회수율**을 낸다.

```
(1) 천장   P(승|x, N)                     정확한 N 을 안다
(3) N̂     Σ_b P̂(b|공고) Σ_{N∈b} P(N|b) P(승|x,N)
(2) 바닥   Σ_N P(N) P(승|x,N)              공고 정보를 안 쓴다
```
🔴 회수율 = `(res₃ − res₂)/(res₁ − res₂)` — 보정이 아니라 **분해능**으로 잰다.
   제대로 주변화한 `(2)` 는 정의상 `P(승|x)` 라 편향이 0 이고, 최소인 건 분해능이다.

🔴 기준집합이 **투찰**이라 크기 편향을 건다: `P(N|무작위 투찰) ∝ N · P(N|무작위 회차)`.
   `(2)` 의 `rel` 이 ~0 이 되는지가 그게 맞는지의 검사다 (지난 라운드에 이게 오류를 잡았다).
   ⚠ 제품 예측기는 이 보정을 쓰면 안 된다 — 거기선 회차가 지정돼 있다.

⚠ `TUNE` 에서만. `nhat_pool.npz` 가 정본 (`ALPHA=2` · 목표 `N_pool(BID_CNT)`).
"""
from __future__ import annotations

import numpy as np

import fx_kernel as K

NH = np.load(r'C:/Users/kano/AppData/Local/Temp/claude/C--Users-kano'
             r'/f2fa05d3-8165-4658-94f7-75535b0fb45e/scratchpad/nhat_pool.npz',
             allow_pickle=True)
EDGES = [2, 5, 10, 30, 100]                 # 버킷 1 / 2-4 / 5-9 / 10-29 / 30-99 / 100+
H = 0.02
XG = K.XGRID

# --- 조견표: P(승|x,N) 을 x격자 × N × α 로 ----------------------------------------
NKN = np.arange(1, int(K.nbid.max()) + 1)
F_ALL = K.Fx_at(np.maximum(NKN, 1), H)
TABS = np.empty((2, len(NKN), len(XG)))
for a2 in (0, 1):
    flag = np.full(len(XG), bool(a2))
    for j, n in enumerate(NKN):
        TABS[a2, j] = K.pwin_v(XG, F_ALL[j], np.full(len(XG), n, float), a2=flag)
print('조견표 2α × %dN × %dx' % TABS.shape[1:])

# --- 평가 대상 ----------------------------------------------------------------
_bi = {b: i for i, b in enumerate(K.bid_id)}
_ki = np.array([_bi.get(b, -1) for b in NH['bid_id']])
_ok = _ki >= 0
print('🔴 nhat 회차 중 xcap2 조인 실패 %d — 버린다. 값을 안 채운다' % int((~_ok).sum()))
Pb = np.zeros((len(K.nbid), 6))
Pb[_ki[_ok]] = NH['P'][_ok]
has = np.zeros(len(K.nbid), bool)
has[_ki[_ok]] = True
has &= K.USABLE & (K.nbid >= 3)

sel = has[K.aid]
XI, AI = K.x[sel], K.aid[sel]
NT = K.nbid[AI]
ACT = K.ACT_ALL[sel]
A2 = K.ALPHA2[AI].astype(int)
print('평가 투찰 %d · 회차 %d · 실제 낙찰률 %.5f' % (len(XI), has.sum(), ACT.mean()))

IX = np.clip(np.searchsorted(XG, XI) - 1, 0, len(XG) - 2)
FR_ = np.clip((XI - XG[IX]) / (XG[IX + 1] - XG[IX]), 0, 1)


def curve_to_p(cc):
    return cc[A2, IX] * (1 - FR_) + cc[A2, IX + 1] * FR_


# (1) 천장
P1 = np.empty(len(XI))
for n in np.unique(NT):
    for a2 in (0, 1):
        q = (NT == n) & (A2 == a2)
        if q.any():
            c = TABS[a2, n - 1]
            P1[q] = c[IX[q]] * (1 - FR_[q]) + c[IX[q] + 1] * FR_[q]

# 학습기 N 분포 → 🔴 크기 편향
wA = np.bincount(K.nbid[K.TRAIN], minlength=len(NKN) + 1)[1:].astype(float)
wA /= wA.sum()
wB = wA * NKN
wB /= wB.sum()
P2 = curve_to_p(np.stack([wB @ TABS[0], wB @ TABS[1]]))

bk = np.digitize(NKN, EDGES)
C3 = np.zeros((6, 2, len(XG)))
EN = np.zeros(6)
for b in range(6):
    m = bk == b
    if not m.any() or wB[m].sum() == 0:
        continue
    ww = wB[m] / wB[m].sum()
    C3[b] = np.stack([ww @ TABS[0][m], ww @ TABS[1][m]])
    EN[b] = (wA[m] / max(wA[m].sum(), 1e-12) * NKN[m]).sum()
PbB = Pb * EN[None, :]
PbB /= np.maximum(PbB.sum(1, keepdims=True), 1e-12)
P3 = (PbB[AI] * np.stack([curve_to_p(C3[b]) for b in range(6)], 1)).sum(1)


def murphy(p, y, nb=200):
    e = np.linspace(0, 1, nb + 1)
    b = np.clip(np.digitize(p, e[1:-1]), 0, nb - 1)
    n = np.bincount(b, minlength=nb).astype(float)
    sp = np.bincount(b, weights=p, minlength=nb)
    sy = np.bincount(b, weights=y, minlength=nb)
    m = n > 0
    N, yb = len(y), y.mean()
    rel = (n[m] * (sp[m] / n[m] - sy[m] / n[m]) ** 2).sum() / N
    res = (n[m] * (sy[m] / n[m] - yb) ** 2).sum() / N
    return rel, res, yb * (1 - yb), float(np.mean((p - y) ** 2))


if __name__ == '__main__':
    print()
    print('=== Murphy (200 bin) — Brier = rel − res + unc ===')
    print('%-22s %10s %10s %10s %10s %11s'
          % ('', 'rel', 'res', 'unc', 'Brier', '항등식'))
    o = {}
    for lab, p in [('(1) 천장 · 정확한 N', P1), ('(3) N̂ 분포 주변화', P3),
                   ('(2) 바닥 · 무조건부', P2)]:
        r = murphy(p, ACT)
        o[lab[1]] = r
        print('%-22s %10.6f %10.6f %10.6f %10.6f %11.1e'
              % (lab, r[0], r[1], r[2], r[3], r[3] - (r[0] - r[1] + r[2])))
    r1, r3, r2 = o['1'][1], o['3'][1], o['2'][1]
    print()
    print('🔴 분해능 회수율 (res₃−res₂)/(res₁−res₂) = %.4f' % ((r3 - r2) / (r1 - r2)))
    print('   Brier 기준                             = %.4f'
          % ((o['2'][3] - o['3'][3]) / (o['2'][3] - o['1'][3])))
    print('⚠ (2) 의 rel 이 ~0 이어야 한다 — 크기 편향이 맞는지의 검사다.')
