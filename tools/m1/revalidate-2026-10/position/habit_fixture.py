"""모듈 책임: 서버 아침 습관 계산이 분석 엔진(habreal_core.py의 kinfo·유지 확률·base·comps_v2s·p2_exact)과 같은 값을 내는지 검사할
합성 시장 fixture를 만들고, 분석 엔진 함수를 그대로 옮긴 numpy 정답과 함께 인자 경로의 TS 파일로 쓴다.

분석 엔진은 결정 시각을 '마감 − 0.16666667시간'(600.000012초)으로 둔다. 정수 초 시각에서 이것은 '결정 시각(마감 − 600초)보다
앞선 것만'과 같다. 경계에 정확히 걸리는 투찰을 일부러 넣어 서버가 같은 판정을 하는지 본다."""
import datetime as dt
import io
import sys

import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
z = np.load("F:/Project/eat-bid/data/mechanism/xcap2.npz", allow_pickle=True)
nat = np.where((~z["R_suspect"]) & (z["floor"] == 90.0) & (z["off"] >= 2) & (z["ym"] <= 202512))[0]
Rn = np.sort(z["R"][nat]); KN = np.arange(9690, 10311) / 10000
PPM = np.round(np.searchsorted(Rn, KN, side="right") / len(Rn) * 1e6) / 1e6
def F(v): return np.interp(np.asarray(v, dtype=float), KN, PPM, left=0.0, right=1.0)
G = np.arange(9800, 10041, 1) / 10000  # 분석 채점(habreal_runall.sh의 GRID_STEP=1)과 같다

DAY = 86400; WIN = 90 * DAY; KEEP = 1000 / 9e6; A_SHRINK = 5; DEC = 0.16666667; LAG = 1200
KST = dt.timezone(dt.timedelta(hours=9))
T0 = int(dt.datetime(2026, 1, 5, tzinfo=KST).timestamp())  # 월요일 00:00 KST
def kst_day(ep): return (int(ep) + 9 * 3600) // 86400
def at(day, hour, minute=0): return T0 + day * DAY + hour * 3600 + minute * 60

REGS = ["101", "102", "103", "104", "105"]; OWN = np.array(["1", "2"]); NONREG = [str(200 + i) for i in range(1, 25)]
DAYS = 140


def build(seed):
    rng = np.random.default_rng(seed)
    base_f = {f: rng.uniform(0.992, 1.002) for f in REGS}
    keep_f = {f: rng.uniform(0.35, 0.85) for f in REGS}
    part_f = {f: rng.uniform(0.35, 0.9) for f in REGS}
    day_x = {}

    def ratio(f, day):
        if (f, day) not in day_x: day_x[(f, day)] = round(float(base_f[f] + rng.normal(0, 0.002)), 8)
        return day_x[(f, day)] if rng.random() < keep_f[f] else round(float(base_f[f] + rng.normal(0, 0.003)), 8)

    hist = {f: [] for f in REGS}  # (개찰, 투찰 순번, x, 마감)
    market = []
    seq = 0
    for day in range(DAYS):
        if day % 7 >= 5: continue
        for f in REGS:
            for hour in rng.choice([9, 10, 11, 13, 15], size=int(rng.integers(0, 3)), replace=False):
                dl = at(day, int(hour)); seq += 1
                hist[f].append((dl + 3600, seq, ratio(f, day), dl))
        for hour in sorted(rng.choice([10, 11, 14], size=int(rng.choice([0, 1, 1, 2])), replace=False)):
            dl = at(day, int(hour)); op = dl + 3600; biz = []; xs = []
            for f in REGS:
                if rng.random() < part_f[f]:
                    x = ratio(f, day); seq += 1; hist[f].append((op, seq, x, dl)); biz.append(f); xs.append(x)
            for o in OWN:
                if rng.random() < 0.8: biz.append(str(o)); xs.append(round(float(rng.normal(0.999, 0.003)), 8))
            for n in rng.choice(NONREG, size=int(rng.integers(2, 7)), replace=False):
                biz.append(str(n)); xs.append(round(float(rng.normal(0.999, 0.004)), 8))
            market.append(dict(op=op, dl=dl, biz=biz, x=np.array(xs)))
    # 경계: 마지막 14시 마감 시장 공고의 결정 시각(마감 − 600초)에 정확히 보이게 되는 같은 날 투찰. 분석은 이것을 보지 않는다.
    last = [q for q in market if (q["dl"] - T0) % DAY == 14 * 3600][-1]
    hist[REGS[0]].append((last["dl"] - 1800, 10**9, 0.9871, last["dl"] - 5400))
    return hist, market, last


def reference(hist, market, targets):
    """분석 엔진(habreal_core.py)의 함수를 자료 구조만 바꿔 그대로 옮겼다."""
    regs = REGS; _regset = set(regs)
    H = {}
    for f in regs:
        a_ = sorted(hist[f], key=lambda r: (r[0], r[1]))
        H[f] = dict(op=np.array([r[0] for r in a_], dtype=np.int64), x=np.array([r[2] for r in a_]),
                    day=np.array([kst_day(r[3]) for r in a_], dtype=np.int64), av=np.array([r[0] + LAG for r in a_], dtype=np.int64))
    MK = sorted(market, key=lambda q: q["op"])
    for q in MK: q["av"] = q["op"] + LAG
    mk_op = np.array([q["op"] for q in MK])
    def dtime(q): return q["dl"] - DEC * 3600
    def visible(f, T, lo_op=None):
        d = H[f]; j = np.searchsorted(d["op"], T, side='right'); a = 0 if lo_op is None else np.searchsorted(d["op"], lo_op, side='left')
        idx = np.arange(a, j); return idx[d["av"][a:j] <= T]
    def kinfo(f, q):
        d = H[f]; T = dtime(q); vis = visible(f, T)
        if len(vis) == 0: return None, None, None
        mm = vis[d["day"][vis] == kst_day(q["dl"])]
        if len(mm) == 0: return d["x"][vis[-1]], "other", None
        xs = d["x"][mm]
        if len(xs) == 1: return xs[0], "s1", xs
        if np.all(np.abs(xs - xs[0]) < KEEP): return d["x"][mm[-1]], "sall", xs
        return d["x"][mm[-1]], "smix", xs
    CATS4 = ("s1", "sall", "smix", "other")
    r4 = {c: [] for c in CATS4}; f4 = {f: {c: [] for c in CATS4} for f in regs}
    for _q in MK:
        for b, v in zip(_q["biz"], _q["x"]):
            if b not in _regset: continue
            a_, c, xs = kinfo(b, _q)
            if a_ is None: continue
            tt = _q["av"]; h2 = float(abs(v - a_) < KEEP)
            h4 = float(np.any(np.abs(xs - v) < KEEP)) if c == "smix" else h2
            r4[c].append((tt, h4)); f4[b][c].append((tt, h4))
    def cum(rs):
        rs = sorted(rs); tt = np.array([a_ for a_, _ in rs]) if rs else np.array([]); vv = np.array([b for _, b in rs]) if rs else np.array([])
        return tt, np.concatenate([[0], np.cumsum(vv)])
    GC4 = {c: cum(r4[c]) for c in CATS4}; FC4 = {f: {c: cum(f4[f][c]) for c in CATS4} for f in regs}
    def wmean(tc, lo, hi):
        tt, cs = tc; a_ = np.searchsorted(tt, lo, side='left'); b = np.searchsorted(tt, hi, side='right'); return cs[b] - cs[a_], b - a_
    def kp_of(GC, FC, f, c, q):
        hi = dtime(q); k, n = wmean(GC[c], hi - 2 * WIN, hi); g = k / n if n >= 20 else 0.3
        k, n = wmean(FC[f][c], hi - 2 * WIN, hi); return (k + A_SHRINK * g) / (n + A_SHRINK)
    def base(q):
        T = dtime(q)
        lo = np.searchsorted(mk_op, T - WIN, side='left'); hi = np.searchsorted(mk_op, T, side='right')
        recent = [p_ for p_ in MK[lo:hi] if p_["av"] <= T]
        pres = {f: 0 for f in regs}; nonreg = []
        for p_ in recent:
            present = set(p_["biz"])
            for f in regs: pres[f] += (f in present)
            m = ~np.isin(p_["biz"], regs) & ~np.isin(p_["biz"], OWN); nonreg.extend(p_["x"][m].tolist())
        info = []
        for f in regs:
            a_, c, xs = kinfo(f, q)
            if a_ is None: continue
            dist = H[f]["x"][visible(f, T, T - WIN)]
            info.append(dict(f=f, p=pres[f] / max(len(recent), 1), a=a_, c=c, xs=xs, kp4=kp_of(GC4, FC4, f, c, q), dist=dist))
        n_comp = int(np.sum(~np.isin(q["biz"], OWN)))
        return info, np.array(nonreg), n_comp, len(recent)
    def coverage(info):
        w = np.array([it["p"] for it in info]); s = np.array([it["c"] != "other" for it in info]); return float(np.sum(w * s) / max(np.sum(w), 1e-9))
    def add_nonreg(comps, info, nonreg, n_comp):
        m = max(0.0, n_comp - sum(it["p"] for it in info))
        if len(nonreg) and m > 0:
            nr = np.asarray(nonreg); uu = np.ones(len(nr)) / len(nr)
            if int(m) > 0: comps.append((nr, uu, float(int(m))))
            if m - int(m) > 1e-9: comps.append((nr, uu * (m - int(m))))
        return comps
    def comps_v2s(info, nonreg, n_comp):
        comps = []
        for it in info:
            d = it["dist"]; p = it["p"]; kp = it["kp4"]; c = it["c"]
            if c == "smix":
                u, cn = np.unique(np.round(it["xs"], 9), return_counts=True); head = (u, p * kp * cn / cn.sum())
            else: head = (np.array([it["a"]]), np.array([p * kp]))
            if len(d) == 0: vals, wts = head[0], head[1] / max(kp, 1e-9)
            else: vals = np.concatenate([head[0], d]); wts = np.concatenate([head[1], np.full(len(d), p * (1 - kp) / len(d))])
            comps.append((vals, wts))
        return add_nonreg(comps, info, nonreg, n_comp)
    YS = np.arange(9700, 10041, 0.2) / 10000; FY = F(YS); WY = np.diff(FY); YL = YS[:-1]; GI = np.searchsorted(YS, G - 1e-12); YM = YL + (YS[1] - YS[0]) / 2.0
    def cdf_lt(vals, wts, grid):
        o = np.argsort(vals); v = vals[o]; w = np.cumsum(wts[o]); k = np.searchsorted(v, grid, side='left'); return np.where(k > 0, w[np.maximum(k - 1, 0)], 0.0)
    def p2_exact(comps):
        LQ = np.zeros((len(G), len(YL)))
        for c_ in comps:
            vals, wts = c_[0], c_[1]; mult = c_[2] if len(c_) > 2 else 1.0
            pin = cdf_lt(vals, wts, G)[:, None] - cdf_lt(vals, wts, YM)[None, :]
            LQ += mult * np.log(np.clip(1.0 - np.clip(pin, 0, 1), 1e-300, 1))
        Q = np.exp(LQ); Q = np.where(YL[None, :] < G[:, None], Q, 0.0); cum_ = np.cumsum(Q * WY[None, :], axis=1)
        A = cum_[np.arange(len(G)), GI - 1]; sub = cum_[:, GI - 1]; return np.triu(A[:, None] + A[None, :] - sub.T, 1), A
    out = []
    for q in targets:
        info, nonreg, n_comp, recent = base(q); cv = coverage(info)
        P, A = p2_exact(comps_v2s(info, nonreg, n_comp))
        i, k = np.unravel_index(np.argmax(P), P.shape); one = int(np.argmax(A))
        gap2 = P[i, k] - np.sort(P[np.triu_indices(len(G), 1)])[-2]; gap1 = A[one] - np.sort(A)[-2]
        out.append(dict(q=q, info=info, nonreg=len(nonreg), n_comp=n_comp, recent=recent, cv=cv, pair=(int(i), int(k)), one=one,
                        P=float(P[i, k]), A=float(A[one]), gap=min(gap1, gap2), ys=len(YS)))
    return out


def targets_of(market, last):
    # 마지막 4주 시장 공고 가운데 오후 마감(아침 결과가 보이는 공고) 셋과 오전 10시 마감 하나, 그리고 경계 공고다.
    late = [q for q in market if q["dl"] >= at(DAYS - 28, 0) and q is not last]
    afternoon = [q for q in late if (q["dl"] - T0) % DAY == 14 * 3600][:3]
    morning = [q for q in late if (q["dl"] - T0) % DAY == 10 * 3600][:1]
    return afternoon + morning + [last]


for seed in range(20261011, 20261211):
    hist, market, last = build(seed)
    targets = targets_of(market, last)
    if len(targets) < 5: continue
    res = reference(hist, market, targets)
    kinds = {it["c"] for r in res for it in r["info"]}
    if min(r["gap"] for r in res) > 1e-7 and kinds == {"s1", "sall", "smix", "other"} and any(r["cv"] < 0.3 for r in res) \
            and any(r["cv"] >= 0.3 for r in res):
        break
else:
    raise SystemExit("조건을 채우는 씨앗을 찾지 못했다")
print(f"씨앗 {seed} · 시장 {len(market)}건 · 대상 {len(res)}건 · 덮임 {[round(r['cv'], 3) for r in res]} · 최소 차 {min(r['gap'] for r in res):.2e} · YS {res[0]['ys']}")


def minutes(ep): return (int(ep) - T0) // 60
def text(v): return f"{v:.8f}"
lines = ["// 손으로 고치지 않는다. tools/m1/revalidate-2026-10/position/habit_fixture.py가 분석 엔진(habreal_core.py)을 옮긴 numpy 구현으로",
         "// 정답을 함께 낸 합성 시장이다. 시각은 `startEpochSeconds`부터 분 단위이고, 투찰 비율은 하한 기준액 대비(배수)다.",
         "export const MORNING_HABIT_FIXTURE = {",
         f"  startEpochSeconds: {T0},",
         f"  regulars: {REGS!r},".replace("'", '"'),
         f"  own: {[str(o) for o in OWN]!r},".replace("'", '"'),
         "  // 업체별 이력: [개찰 분, 마감 분, 배수]. 개찰 순(같으면 투찰 순)이다.",
         "  histories: {"]
for f in REGS:
    a_ = sorted(hist[f], key=lambda r: (r[0], r[1]))
    lines.append(f'    "{f}": [' + ", ".join(f"[{minutes(r[0])}, {minutes(r[3])}, {text(r[2])}]" for r in a_) + "],")
lines += ["  },", "  // 시장 공고: [개찰 분, 마감 분, 업체, 배수] — 개찰 순이다.", "  market: ["]
for q in sorted(market, key=lambda q: q["op"]):
    lines.append(f"    [{minutes(q['op'])}, {minutes(q['dl'])}, [" + ", ".join(f'"{b}"' for b in q["biz"]) + "], ["
                 + ", ".join(text(v) for v in q["x"]) + "]],")
kind = {"s1": "single", "sall": "repeated", "smix": "mixed", "other": "earlier"}
lines += ["  ],", "  expected: ["]
for r in res:
    q = r["q"]
    lines.append(f"    {{ deadlineMinute: {minutes(q['dl'])}, competitorCount: {r['n_comp']}, recentRounds: {r['recent']}, "
                 f"nonRegularRatios: {r['nonreg']}, coverage: {r['cv']!r},")
    lines.append("      regulars: [")
    for it in r["info"]:
        lines.append(f'        {{ firm: "{it["f"]}", participation: {float(it["p"])!r}, anchor: {text(it["a"])}, kind: "{kind[it["c"]]}", '
                     f'keepRate: {float(it["kp4"])!r}, recentRatios: {len(it["dist"])} }},')
    lines.append("      ],")
    lines.append(f'      pair: ["{G[r["pair"][0]]:.4f}", "{G[r["pair"][1]]:.4f}"], pairWin: {r["P"]!r}, single: "{G[r["one"]]:.4f}", singleWin: {r["A"]!r} }},')
lines += ["  ],", "} as const;", ""]
open(sys.argv[1], "w", encoding="utf-8", newline="\n").write("\n".join(lines))
