"""모듈 책임: sql/10 출력(2026-06~09 두 업체 공고의 모든 투찰)으로 매달 다시 고르기의 9월 봉인 채점(6~8월로 고름)과 10월 배수(7~9월로 고름)를 낸다. 운영 DB에 투찰 시각이 없어 전국 규칙의 대역은 최종 투찰 수로 고른다."""
import collections
import io
import sys

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
rows = [l.rstrip("\n").split("|") for l in open(sys.argv[1], encoding="utf-8") if l.count("|") == 5]
OWN = {1947, 1954}
R = {}; YM = {}; B = collections.defaultdict(list)
for ext, ym, base, plan, sp, xv in rows:
    R[ext] = float(plan) / float(base); YM[ext] = int(ym); B[ext].append((int(sp), float(xv)))
z = np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz", allow_pickle=True)
nat = np.where((~z["R_suspect"]) & (z["floor"] == 90.0) & (z["off"] >= 2) & (z["ym"] <= 202512))[0]
Rn = np.sort(z["R"][nat]); KN = np.arange(9690, 10311) / 10000
PPM = np.round(np.searchsorted(Rn, KN, side="right") / len(Rn) * 1e6) / 1e6
def F(v): return np.interp(np.asarray(v, dtype=float), KN, PPM, left=0.0, right=1.0)
G = np.arange(9800, 10041, 5) / 10000; FG = F(G)
RULE = [(2, 9, 1.0040, 0.9960), (10, 19, 0.9925, 1.0000), (20, 29, 0.9925, 0.9885), (30, 39, 0.9885, 0.9935), (40, 69, 0.9860, 0.9920), (70, 10**9, 0.9835, 0.9890)]
def rule_of(n):
    for lo, hi, a, b in RULE:
        if lo <= n <= hi: return (a, b)
    return None
ok = [e for e in B if 0.969 <= R[e] <= 1.031]
comp = {e: np.sort([v for sp, v in B[e] if sp not in OWN]) for e in ok}
by = collections.defaultdict(list)
for e in ok: by[YM[e]].append(e)
def mats(es):
    s1 = np.zeros(len(G)); s2 = np.zeros((len(G), len(G)))
    for e in es:
        o = comp[e]; j = np.searchsorted(o, G, side="left"); b = np.where(j > 0, o[np.maximum(j - 1, 0)], -1.0)
        Fb = np.where(b < 0, 0.0, F(b)); p1 = FG - Fb; s1 += p1
        s2 += np.triu(p1[:, None] + np.maximum(0.0, FG[None, :] - np.maximum(Fb[None, :], FG[:, None])), 1)
    return s1, s2
def pick(es, k):
    s1, s2 = mats(es)
    if k == 1: return (G[int(np.argmax(s1))],)
    i, j = np.unravel_index(np.argmax(s2), s2.shape); return (G[i], G[j])
def exp_of(o, xs):
    p = 0.0; prev = -1.0
    for v in sorted(xs):
        j = np.searchsorted(o, v, side="left"); c = o[j - 1] if j > 0 else -1.0
        p += max(0.0, float(F(v)) - float(F(max(c, prev)))) if v > prev else 0.0; prev = v
    return p
def won(o, Rr, xs):
    oo = o[o >= Rr]; best = oo[0] if len(oo) else np.inf
    return any(v >= Rr and v < best for v in xs)
sep = by[202609]; train = by[202606] + by[202607] + by[202608]
print(f"공고 {len(B)} (예정가격 비율 ±3.1% 밖 {len(B) - len(ok)}) · 9월 {len(sep)}건 · 학습 6~8월 {len(train)}건")
for k in (2, 1):
    xs = pick(train, k)
    rx = lambda e: () if rule_of(len(B[e])) is None else rule_of(len(B[e]))[:k]
    print(f"[{k}장] 6~8월로 고른 배수 {[f'{v:.4f}' for v in xs]} · 9월 맞춤 기대 {sum(exp_of(comp[e], xs) for e in sep):.1f} · 전국 규칙 기대 {sum(exp_of(comp[e], rx(e)) for e in sep):.1f}"
          f" · 운 {sum(k / (len(comp[e]) + k) for e in sep):.1f} · 실제 낙찰 맞춤 {sum(won(comp[e], R[e], xs) for e in sep)} / 전국 {sum(won(comp[e], R[e], rx(e)) for e in sep)}")
oct_train = by[202607] + by[202608] + by[202609]
for k in (2, 1):
    xs = pick(oct_train, k)
    print(f"[{k}장] 10월 배수(7~9월 {len(oct_train)}건으로 고름): {[f'{v:.4f} (기초금액의 {v * 90:.2f}%)' for v in xs]}")
