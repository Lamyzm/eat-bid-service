# -*- coding: utf-8 -*-
"""M4 — GBDT 로 P(낙찰 | 마감 전 관측, x) 를 직접 학습하고 argmax x 로 투찰한다.

🔴 정보 대칭 (사장 지시의 핵심 · `PREREG_m4m5.md` §1):
```
features() 가 금지 열에 **접근 자체를 안 한다** — 실현 R · 경쟁자 벡터 · nbid_live · wd · rnk
M1 의 decide()/score() 분리를 그대로 가져온다
```
🔴 누출 차단: 학습에서 **아버지 두 사업자의 행 전부 제외** (§2).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier

import fx_kernel as K

FATHER = ('3118152843', '7175001228')
_AS = K.AS
_ai = {b: i for i, b in enumerate(_AS['bid_id'])}
_k = np.array([_ai.get(b, -1) for b in K.bid_id])
_ok = _k >= 0
_kc = np.clip(_k, 0, None)
BGNG = np.where(_ok, _AS['bgng'][_kc], np.nan)
_, SIDO = np.unique(np.where(_ok, _AS['sido'][_kc], ''), return_inverse=True)
_, PURR = np.unique(np.where(_ok, _AS['purr'][_kc], ''), return_inverse=True)


def features(rows, xv):
    """🔴 마감 전 관측 + 후보 x 만. 금지 열을 안 읽는다."""
    a = K.aid[rows]
    return np.column_stack([
        np.log(np.maximum(K.nbid[a], 1)),      # BID_CNT — 마감 전 관측됨
        np.log(np.maximum(BGNG[a], 1)),
        K.ALPHA2[a].astype(float),
        ITEM[a].astype(float),
        SIDO[a].astype(float),
        INST_N[a],                             # 기관의 학습기 평균 log N — 마감 전 관측 가능
        INST_C[a],                             # 기관의 학습기 회차 수
        (K.ym[a] // 100 * 12 + K.ym[a] % 100).astype(float),
        xv,
    ])


CAT = [3, 4]                                    # item · sido (기관은 5,350 범주라 수치 요약으로)
ITEM = K.BL['item'].astype(np.int16)
IS_F = np.isin(K.BL['biz_no'], FATHER)

# 🔴 기관 요약은 **학습기에서만** 만든다. 승패 라벨을 안 쓴다 (목표 인코딩 아님)
_tra = K.TRAIN & _ok
_cnt = np.bincount(PURR[_tra], minlength=PURR.max() + 1).astype(float)
_sum = np.bincount(PURR[_tra], weights=np.log(np.maximum(K.nbid[_tra], 1)),
                   minlength=PURR.max() + 1)
_gm = np.log(np.maximum(K.nbid[_tra], 1)).mean()
INST_N = np.where(_cnt[PURR] > 0, _sum[PURR] / np.maximum(_cnt[PURR], 1), _gm)
INST_C = np.log1p(_cnt[PURR])


def fit(seed=0, max_iter=300, sub=1500000):
    tr = K.TRAIN[K.aid] & ~IS_F & _ok[K.aid]    # 🔴 아버지 행 제외
    idx = np.flatnonzero(tr)
    rng = np.random.default_rng(seed)
    if len(idx) > sub:
        idx = rng.choice(idx, sub, replace=False)
    X = features(idx, K.x[idx])
    y = K.ACT_ALL[idx]
    m = HistGradientBoostingClassifier(
        max_iter=max_iter, learning_rate=0.08, max_leaf_nodes=63,
        categorical_features=CAT, random_state=seed)
    m.fit(X, y)
    print('M4 적합: 표본 %d (아버지 행 제외) · 양성률 %.5f' % (len(idx), y.mean()))
    return m


GRID = np.linspace(0.960, 1.045, 86)


def decide(model, rows, chunk=20000):
    """후보 x 격자를 훑어 P(낙찰) 최대점. 🔴 실현값에 접근 없음."""
    out = np.empty(len(rows))
    for a in range(0, len(rows), chunk):
        r = rows[a:a + chunk]
        best = np.full(len(r), -1.0)
        arg = np.zeros(len(r))
        for xv in GRID:
            p = model.predict_proba(features(r, np.full(len(r), xv)))[:, 1]
            up = p > best
            best[up] = p[up]
            arg[up] = xv
        out[a:a + len(r)] = arg
    return out
