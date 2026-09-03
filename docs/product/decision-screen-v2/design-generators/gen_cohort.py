"""모듈 책임: 비교집단 탭 v3. 전국·도·시군·이 기관 네 모집단의 낙찰률 분포를 나란히 두고 고른 것을 크게 그린다.

관측된 분포만 그린다. 추천 구간·유리 판정은 넣지 않는다. 표본이 적은 모집단은 회색으로 두고 그렇다고 쓴다.
토큰은 gen_merged가 소유하므로 호출 때 모듈을 받아 쓴다.
"""

from __future__ import annotations

BIN0, STEP, NBIN = 89.90, 0.02, 40
SELECTED = 1          # 기본 선택 모집단. 0 전국 · 1 도 · 2 시군 · 3 이 기관
PERIOD = "12개월"
COMPARE = True        # 지난 달 윤곽선 겹치기


def _smooth(bins: list[float]) -> list[float]:
    out = []
    for i, v in enumerate(bins):
        left = bins[i - 1] if i else v
        right = bins[i + 1] if i + 1 < len(bins) else v
        out.append((left + 2 * v + right) / 4)
    return out


def _shift(bins: list[float], k: int) -> list[float]:
    if k >= 0:
        return [0.0] * k + bins[: len(bins) - k]
    return bins[-k:] + [0.0] * (-k)


def populations(m) -> list[dict]:
    """(이름, 칸별 수, 표본, 상태). 전국·도·시군은 지어낸 분포, 이 기관은 실제 회차에서 센다."""
    base = [float(v) for v in m.COHORT]
    total = sum(base)
    nat = [v * 12480 / total for v in _smooth(base)]
    prov = [v * 1150 / total for v in base]
    dist = [v * 210 / total for v in _shift(base, 1)]
    school = [0.0] * NBIN
    for row in m.sel_rows():
        idx = int((row[3] - BIN0) / STEP)
        if 0 <= idx < NBIN:
            school[idx] += 1
    region = m.SCHOOL["region"].split()
    names = ("전국", region[0], region[-1], "이 학교")
    out = []
    for name, bins in zip(names, (nat, prov, dist, school)):
        n = round(sum(bins))
        state = "ok" if n >= 30 else "few" if n >= 10 else "none"
        out.append({"name": name, "bins": bins, "n": n, "state": state})
    return out


def mode_range(bins: list[float]) -> tuple[float, float, float]:
    """최빈 칸에서 밀도가 절반 아래로 떨어질 때까지 넓힌 연속 구간과 그 비율."""
    peak = max(bins)
    center = bins.index(peak)
    lo = hi = center
    while lo > 0 and bins[lo - 1] >= peak / 2:
        lo -= 1
    while hi + 1 < NBIN and bins[hi + 1] >= peak / 2:
        hi += 1
    share = sum(bins[lo:hi + 1]) / max(sum(bins), 1) * 100
    return BIN0 + lo * STEP, BIN0 + (hi + 1) * STEP, share


def median(bins: list[float]) -> float:
    half = sum(bins) / 2
    acc = 0.0
    for i, v in enumerate(bins):
        acc += v
        if acc >= half:
            return BIN0 + i * STEP + STEP / 2
    return BIN0


def mini(m, pop: dict, w: int, h: int, on: bool) -> str:
    peak = max(pop["bins"]) or 1
    bw = w / NBIN
    grey = pop["state"] != "ok"
    color = m.FAINT if grey else (m.INK2 if on else m.BAR)
    bars = "".join(
        f'<rect x="{i * bw:.1f}" y="{h - v / peak * h:.1f}" width="{bw - 1:.1f}" height="{v / peak * h:.1f}" fill="{color}"/>'
        for i, v in enumerate(pop["bins"]) if v > 0
    )
    mx = (m.MY - BIN0) / (STEP * NBIN) * w
    line = f'<line x1="{mx:.1f}" y1="0" x2="{mx:.1f}" y2="{h}" stroke="{m.BLUE}" stroke-width="2"/>'
    return f'<svg viewBox="0 0 {w} {h}" width="{w}" height="{h}" style="display:block">{bars}{line}</svg>'


def selector(m, pops: list[dict], inner: int) -> str:
    cards = []
    w = (inner - 12 * 3) // 4 - 32
    for i, pop in enumerate(pops):
        on = i == SELECTED
        grey = pop["state"] != "ok"
        label = {"ok": f"{pop['n']:,}회차", "few": f"{pop['n']}회차 · 표본 적음", "none": f"{pop['n']}회차 · 표본 부족"}[pop["state"]]
        cards.append(
            f'<div style="flex:1; min-width:0; padding:12px 16px; border-radius:8px;'
            f' background:{"rgba(7,25,76,0.07)" if on else "transparent"};">'
            '<div style="display:flex; align-items:baseline; gap:8px;">'
            f'<span style="font-size:15px; font-weight:600; color:{m.FAINT if grey else m.INK}; white-space:nowrap;">{pop["name"]}</span>'
            f'<span class="lbl" style="margin-left:auto; color:{m.FAINT if grey else m.INK2};">{label}</span></div>'
            f'<div style="margin-top:8px;">{mini(m, pop, w, 44, on)}</div></div>'
        )
    return f'<div style="display:flex; gap:12px;">{"".join(cards)}</div>'


def period_chips(m) -> str:
    chips = "".join(
        f'<span class="chip{" on" if p == PERIOD else ""}" style="height:32px; padding:0 12px; font-size:15px;">{p}</span>'
        for p in ("이번 달", "지난 달", "3개월", "12개월", "직접")
    )
    toggle = (
        f'<span class="lbl" style="margin-left:auto; display:inline-flex; align-items:center; gap:6px;">'
        f'<span style="width:14px; height:14px; border-radius:4px; background:{m.BLUE if COMPARE else m.PANEL};'
        f' box-shadow:inset 0 0 0 1.5px {m.BLUE if COMPARE else m.BAR};"></span>지난 달 겹쳐 보기</span>'
    )
    return f'<div style="display:flex; align-items:center; gap:6px;">{chips}{toggle}</div>'


def summary(m, pop: dict) -> str:
    lo, hi, share = mode_range(pop["bins"])
    mid = median(pop["bins"])
    below = sum(v for i, v in enumerate(pop["bins"]) if BIN0 + i * STEP + STEP < m.MY)
    above = pop["n"] - below

    def cell(k: str, v: str, tail: str = "") -> str:
        t = f'<span class="lbl">{tail}</span>' if tail else ""
        return (
            '<div style="display:flex; flex-direction:column; gap:2px; padding:10px 16px; flex:1;">'
            f'<span class="lbl" style="color:{m.FAINT};">{k}</span>'
            f'<span style="display:flex; align-items:baseline; gap:8px;">'
            f'<span class="num" style="font-size:20px; color:{m.INK}; white-space:nowrap;">{v}</span>{t}</span></div>'
        )

    return (
        f'<div class="inner" style="display:flex; align-items:stretch;">'
        f'{cell("많이 나온 값", f"{lo:.2f} ~ {hi:.2f}", f"전체의 {share:.0f}%")}'
        f'{cell("절반이 이 아래", f"{mid:.3f}")}'
        f'{cell("내 값보다 낮게 낙찰", f"{round(below):,}회", f"높게 {round(above):,}회")}'
        "</div>"
    )


def big_chart(m, pop: dict, compare: list[float] | None, inner: int) -> str:
    x0, w, top, base = 88.0, float(inner - 120), 40.0, 400.0
    peak = max(pop["bins"]) or 1
    bar_w = w / NBIN - 2
    bars = "".join(
        f'<rect x="{x0 + i * w / NBIN:.1f}" y="{base - v / peak * (base - top):.1f}"'
        f' width="{bar_w:.1f}" height="{v / peak * (base - top):.1f}" fill="{m.BAR}" rx="1"/>'
        for i, v in enumerate(pop["bins"])
    )
    outline = ""
    if compare:
        cpeak = max(compare) or 1
        pts = " ".join(
            f"{x0 + (i + 0.5) * w / NBIN:.1f},{base - v / cpeak * (base - top):.1f}"
            for i, v in enumerate(compare)
        )
        outline = f'<polyline points="{pts}" fill="none" stroke="{m.INK2}" stroke-width="1.5" stroke-dasharray="4 3"/>'
    ticks = "".join(
        f'<text x="{x0 + (v - BIN0) / (STEP * NBIN) * w:.1f}" y="{base + 20}" text-anchor="middle"'
        f' font-size="13" font-weight="600" fill="{m.INK2}">{v:.1f}</text>'
        for v in (89.9, 90.1, 90.3, 90.5, 90.7)
    )
    mx = x0 + (m.MY - BIN0) / (STEP * NBIN) * w
    return (
        f'<svg viewBox="0 0 {inner} 440" width="{inner}" height="440" style="display:block">'
        f"{bars}{outline}{ticks}"
        f'<line x1="{mx:.1f}" y1="{top - 8}" x2="{mx:.1f}" y2="{base}" stroke="{m.BLUE}" stroke-width="3"/>'
        f'<rect x="{mx - 42:.1f}" y="{top - 30}" width="84" height="22" rx="6" fill="{m.BLUE}"/>'
        f'<text x="{mx:.1f}" y="{top - 14}" text-anchor="middle" font-size="13" font-weight="700" fill="white">내 값 {m.MY:.3f}</text>'
        "</svg>"
    )


def render(m, inner: int) -> str:
    pops = populations(m)
    pop = pops[SELECTED]
    compare = _shift([v / 12 for v in pop["bins"]], -1) if COMPARE else None
    foot = (
        f'{pop["name"]} · {m.axis_mod.CATEGORY} · 하한율 90 · {PERIOD} · {pop["n"]:,}회차'
        f' · 08-13 수집분 · 계산 v3 · 점선은 지난 달'
    )
    return (
        f'{selector(m, pops, inner)}'
        f'<div style="padding-top:12px;">{summary(m, pop)}</div>'
        f'{big_chart(m, pop, compare, inner)}'
        f'<div class="lbl">{foot}</div>'
    )


def heatmap(m, inner: int) -> str:
    """크게 보기. 12개월 × 칸. 달마다 몰린 자리가 움직였는지 한 눈에 본다."""
    months = ("25-09", "25-10", "25-11", "25-12", "26-01", "26-02", "26-03", "26-04", "26-05", "26-06", "26-07", "26-08")
    base = [float(v) for v in m.COHORT]
    x0, w, row_h, top = 96.0, float(inner - 200), 30.0, 32.0
    cells, labels = [], []
    for r, mo in enumerate(months):
        drift = (r % 5) - 2
        bins = [v / 12 * (1 + 0.08 * ((r * 7 + i) % 3 - 1)) for i, v in enumerate(_shift(base, drift // 2))]
        peak = max(bins) or 1
        y = top + r * row_h
        for i, v in enumerate(bins):
            if v <= 0:
                continue
            cells.append(
                f'<rect x="{x0 + i * w / NBIN:.1f}" y="{y:.1f}" width="{w / NBIN - 1:.1f}" height="{row_h - 2:.1f}"'
                f' fill="{m.INK}" opacity="{0.06 + 0.7 * v / peak:.2f}" rx="2"/>'
            )
        labels.append(
            f'<text x="{x0 - 12}" y="{y + row_h / 2 + 5:.1f}" text-anchor="end" font-size="13" font-weight="600" fill="{m.INK2}">{mo}</text>'
            f'<text x="{x0 + w + 12:.1f}" y="{y + row_h / 2 + 5:.1f}" font-size="13" font-weight="600" fill="{m.INK2}">{round(sum(bins)):,}회차</text>'
        )
    ticks = "".join(
        f'<text x="{x0 + (v - BIN0) / (STEP * NBIN) * w:.1f}" y="{top + 12 * row_h + 20}" text-anchor="middle"'
        f' font-size="13" font-weight="600" fill="{m.INK2}">{v:.1f}</text>'
        for v in (89.9, 90.1, 90.3, 90.5, 90.7)
    )
    mx = x0 + (m.MY - BIN0) / (STEP * NBIN) * w
    h = top + 12 * row_h + 40
    return (
        f'<svg viewBox="0 0 {inner} {h:.0f}" width="{inner}" height="{h:.0f}" style="display:block">'
        f'{"".join(cells)}{"".join(labels)}{ticks}'
        f'<line x1="{mx:.1f}" y1="{top - 8}" x2="{mx:.1f}" y2="{top + 12 * row_h}" stroke="{m.BLUE}" stroke-width="3"/>'
        f'<rect x="{mx - 42:.1f}" y="{top - 32}" width="84" height="22" rx="6" fill="{m.BLUE}"/>'
        f'<text x="{mx:.1f}" y="{top - 16}" text-anchor="middle" font-size="13" font-weight="700" fill="white">내 값 {m.MY:.3f}</text>'
        "</svg>"
    )
