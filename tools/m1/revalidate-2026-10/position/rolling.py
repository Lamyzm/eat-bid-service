"""모듈 책임: 오뚜기축산·신성유통이 넣은 하한율 90 공고(김해 시장)에서 '직전 W개월 경쟁 배치로 매달 다시 고르기'를 걸어가며 채점한다. W는 2025년 걸어가기로만 고르고 2026-01~08은 한 번만 채점한다(실험 기록 §14, 제품 최근 3개월 맞춤의 근거)."""
import io
import json
import sys

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
z = np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz", allow_pickle=True)
cnt = z["off"]; x = z["x"]; R = z["R"]; Rs = z["R_suspect"]; ym = z["ym"]; floor = z["floor"]; biz = z["biz_no"]; t = z["t"]
starts = np.concatenate([[0], np.cumsum(cnt)[:-1]]); rounds = np.repeat(np.arange(len(cnt)), cnt)
OWN = ["3118152843", "7175001228"]
market = [r for r in np.unique(rounds[np.isin(biz, OWN)]).tolist() if not Rs[r] and floor[r] == 90.0 and 202401 <= ym[r] <= 202608]
NAS = np.bincount(rounds[t >= 1.0], minlength=len(cnt))  # 마감 1시간 전 참여 수(전국 규칙의 대역 기준)

# 제품과 같은 분포표: 0.0001 매듭 백만분율, 선형 보간(plannedcdf.py)
nat = np.where((~Rs) & (floor == 90.0) & (cnt >= 2) & (ym <= 202512))[0]
Rn = np.sort(R[nat]); KN = np.arange(9690, 10311) / 10000
PPM = np.round(np.searchsorted(Rn, KN, side="right") / len(Rn) * 1e6) / 1e6
def F(v): return np.interp(np.asarray(v, dtype=float), KN, PPM, left=0.0, right=1.0)

G = np.arange(9800, 10041, 5) / 10000; FG = F(G)
# 전국 규칙 2026-10-10판 하한율 90의 1·2번 배수(마감 1시간 전 참여 수 대역)
RULE = [(2, 9, 1.0040, 0.9960), (10, 19, 0.9925, 1.0000), (20, 29, 0.9925, 0.9885), (30, 39, 0.9885, 0.9935), (40, 69, 0.9860, 0.9920), (70, 10**9, 0.9835, 0.9890)]
def rule_of(n):
    for lo, hi, a, b in RULE:
        if lo <= n <= hi: return (a, b)
    return None

def competitors(r):
    s, e = starts[r], starts[r] + cnt[r]
    return np.sort(x[s:e][~np.isin(biz[s:e], OWN)])

def exp_of(o, xs):
    """두 업체 대신 xs(오름차순)를 냈을 때 예정가격 추첨을 적분한 낙찰 확률."""
    p = 0.0; prev = -1.0
    for v in sorted(xs):
        j = np.searchsorted(o, v, side="left"); c = o[j - 1] if j > 0 else -1.0
        p += max(0.0, float(F(v)) - float(F(max(c, prev)))) if v > prev else 0.0; prev = v
    return p

def won(o, Rr, xs):
    oo = o[o >= Rr]; best = oo[0] if len(oo) else np.inf
    return any(v >= Rr and v < best for v in xs)

per = {}
for r in market:
    o = competitors(r); j = np.searchsorted(o, G, side="left"); b = np.where(j > 0, o[np.maximum(j - 1, 0)], -1.0)
    Fb = np.where(b < 0, 0.0, F(b)); p1 = FG - Fb
    p2 = np.triu(p1[:, None] + np.maximum(0.0, FG[None, :] - np.maximum(Fb[None, :], FG[:, None])), 1)
    per[r] = (o, p1, p2)
months = sorted({int(ym[r]) for r in market}); by = {m: [r for r in market if int(ym[r]) == m] for m in months}
def shift(m, k):
    y, mm = divmod(m, 100); q = y * 12 + mm - 1 - k; return (q // 12) * 100 + q % 12 + 1

def pick(m, W, k):
    if k == 1:
        T = sum((per[r][1] for q in range(1, W + 1) for r in by.get(shift(m, q), [])), np.zeros(len(G)))
        return (G[int(np.argmax(T))],)
    T = sum((per[r][2] for q in range(1, W + 1) for r in by.get(shift(m, q), [])), np.zeros((len(G), len(G))))
    i, j = np.unravel_index(np.argmax(T), T.shape); return (G[i], G[j])

def score(test_months, W, k):
    res = {"rounds": 0, "pick": 0.0, "rule": 0.0, "lot": 0.0, "pickWins": 0, "ruleWins": 0, "diff": []}
    for m in test_months:
        xs = pick(m, W, k)
        for r in by[m]:
            o = per[r][0]; rl = rule_of(int(NAS[r])); rx = () if rl is None else rl[:k]
            a = exp_of(o, xs); b = exp_of(o, rx)
            res["rounds"] += 1; res["pick"] += a; res["rule"] += b; res["lot"] += k / (len(o) + k)
            res["pickWins"] += won(o, float(R[r]), xs); res["ruleWins"] += won(o, float(R[r]), rx); res["diff"].append(a - b)
    return res

m25 = [m for m in months if 202501 <= m <= 202512]; m26 = [m for m in months if 202601 <= m <= 202608]
out = {}
for k in (2, 1):
    W25 = {W: score(m25, W, k)["pick"] for W in (1, 2, 3, 6, 12)}
    Wb = max(W25, key=W25.get)
    s = score(m26, Wb, k); d = np.array(s["diff"]); rng = np.random.default_rng(7)
    bs = np.array([rng.choice(d, len(d)).sum() for _ in range(20000)])
    print(f"\n[{k}장] 2025 걸어가기 기대 낙찰(창별) {{{', '.join(f'{W}개월: {v:.1f}' for W, v in W25.items())}}} → W={Wb}")
    print(f"  2026-01~08 {s['rounds']}건: 맞춤 기대 {s['pick']:.1f} · 전국 규칙 기대 {s['rule']:.1f} · 운 {s['lot']:.1f} · 실제 낙찰 맞춤 {s['pickWins']} / 전국 {s['ruleWins']}")
    print(f"  맞춤 − 전국 기대 차이 {d.sum():.2f} · 공고 재표집 90% 구간 {np.quantile(bs, .05):.2f}~{np.quantile(bs, .95):.2f}")
    out[k] = {"W": Wb, "rounds": s["rounds"], "expectedWins": round(s["pick"], 1), "ruleExpectedWins": round(s["rule"], 1),
              "lotteryExpectedWins": round(s["lot"], 1), "wins": int(s["pickWins"]), "ruleWins": int(s["ruleWins"]),
              "diff90": [round(float(np.quantile(bs, .05)), 2), round(float(np.quantile(bs, .95)), 2)]}
win = [sum(len(by.get(shift(m, q), [])) for q in range(1, 4)) for m in m25 + m26]
print("\n걸어가기 학습 창(직전 3개월) 공고 수 최소", min(win))
json.dump(out, open("rolling.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
