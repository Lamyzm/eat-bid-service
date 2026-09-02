# -*- coding: utf-8 -*-
"""모듈 책임: M5 재실행 — 예산을 M4 와 맞춘다. 사전 등록 `docs/experiments/2026-09-02-PREREG-m5-rerun.md` (커밋 3f0eec4).

🔴 진단(D1·D2·D3)을 성능 수치보다 **먼저** 낸다. 퇴화면 성능을 해석하지 않는다.
⚠ 1차 실행(m5_nn.py, 40만 행·7 에폭)은 기록으로 보존한다. 이 파일이 정본이다.
"""
from __future__ import annotations
import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

import fx_kernel as K
import m4_gbdt as M4

FATHER = ('3118152843', '7175001228')
SEED = 0


def mat(rows, xv):
    """M4.features 와 **같은 정보**. 범주만 원핫으로 편다."""
    F = M4.features(rows, xv)
    a = K.aid[rows]
    item = np.zeros((len(rows), 9), np.float32)
    item[np.arange(len(rows)), np.clip(M4.ITEM[a], 0, 8)] = 1
    sido = np.zeros((len(rows), 17), np.float32)
    sido[np.arange(len(rows)), np.clip(M4.SIDO[a], 0, 16)] = 1
    num = F[:, [0, 1, 2, 5, 6, 7, 8]].astype(np.float32)
    return np.hstack([num, item, sido])


def fit(seed=SEED, sub=1_500_000, max_iter=200, patience=15):
    """🔴 예산 맞춤: 행 수 M4 와 동일 · 반복 상한을 조기종료가 구속하도록 넉넉히."""
    tr = K.TRAIN[K.aid] & ~M4.IS_F & M4._ok[K.aid]      # 아버지 행 제외
    idx = np.flatnonzero(tr)
    rng = np.random.default_rng(seed)
    if len(idx) > sub:
        idx = rng.choice(idx, sub, replace=False)
    X = mat(idx, K.x[idx]); y = K.ACT_ALL[idx]
    sc = StandardScaler().fit(X)
    m = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-4, batch_size=4096,
                      learning_rate_init=2e-3, max_iter=max_iter, early_stopping=True,
                      n_iter_no_change=patience, random_state=seed, verbose=False)
    m.fit(sc.transform(X), y)
    print('M5 재실행 적합: 표본 %d · 양성률 %.5f · **%d 에폭에서 종료** (상한 %d)'
          % (len(idx), y.mean(), m.n_iter_, max_iter))
    print('   상한이 구속했나: %s' % ('예 — 예산 부족' if m.n_iter_ >= max_iter else '아니오 — 수렴'))
    return m, sc


def pcurve(model, sc, rows, grid):
    """행 × 격자 의 P(낙찰) 곡면."""
    out = np.empty((len(rows), len(grid)))
    for j, xv in enumerate(grid):
        out[:, j] = model.predict_proba(sc.transform(mat(rows, np.full(len(rows), xv))))[:, 1]
    return out


def decide(model, sc, rows, chunk=8000):
    out = np.empty(len(rows))
    for a in range(0, len(rows), chunk):
        r = rows[a:a + chunk]
        P = pcurve(model, sc, r, M4.GRID)
        out[a:a + len(r)] = M4.GRID[P.argmax(1)]
    return out
