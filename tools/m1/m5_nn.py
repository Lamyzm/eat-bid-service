# -*- coding: utf-8 -*-
"""모듈 책임: M5 — 신경망(MLP). 🔴 M4 와 **같은 특징·같은 정보 규율**. 공정 비교가 요점이다."""
from __future__ import annotations

import numpy as np
from sklearn.neural_network import MLPClassifier
from sklearn.preprocessing import StandardScaler

import fx_kernel as K
import m4_gbdt as M4


def _mat(rows, xv):
    """M4.features 와 동일한 정보. 신경망용으로 범주를 원핫·수치를 표준화만 한다."""
    F = M4.features(rows, xv)
    a = K.aid[rows]
    item = np.zeros((len(rows), 9))
    item[np.arange(len(rows)), np.clip(M4.ITEM[a], 0, 8)] = 1
    sido = np.zeros((len(rows), 17))
    sido[np.arange(len(rows)), np.clip(M4.SIDO[a], 0, 16)] = 1
    num = F[:, [0, 1, 2, 5, 6, 7, 8]]           # 범주 두 열을 빼고 나머지
    return np.hstack([num, item, sido])


_SC = None


def fit(seed=0, sub=400000):
    global _SC
    tr = K.TRAIN[K.aid] & ~M4.IS_F & M4._ok[K.aid]
    idx = np.flatnonzero(tr)
    rng = np.random.default_rng(seed)
    if len(idx) > sub:
        idx = rng.choice(idx, sub, replace=False)
    X = _mat(idx, K.x[idx])
    _SC = StandardScaler().fit(X)
    m = MLPClassifier(hidden_layer_sizes=(128, 64), alpha=1e-4, batch_size=4096,
                      learning_rate_init=2e-3, max_iter=40, early_stopping=True,
                      n_iter_no_change=5, random_state=seed)
    m.fit(_SC.transform(X), K.ACT_ALL[idx])
    print('M5 적합: 표본 %d (아버지 행 제외) · 반복 %d' % (len(idx), m.n_iter_))
    return m


def decide(model, rows, chunk=8000):
    out = np.empty(len(rows))
    for a in range(0, len(rows), chunk):
        r = rows[a:a + chunk]
        best = np.full(len(r), -1.0)
        arg = np.zeros(len(r))
        for xv in M4.GRID:
            p = model.predict_proba(_SC.transform(_mat(r, np.full(len(r), xv))))[:, 1]
            up = p > best
            best[up] = p[up]
            arg[up] = xv
        out[a:a + len(r)] = arg
    return out
