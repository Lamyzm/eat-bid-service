"""모듈 책임: 비교집단을 주식 호가창처럼 그린다. 사정률 0.01 줄 × 모집단 열, 칸마다 낙찰 횟수.

막대 히스토그램은 '얼마나'는 보이지만 '정확히 어느 값에'가 안 보인다. 호가창은 둘을 같이 준다.
전국·도·시군은 지어낸 분포이고 이 학교는 실제 회차에서 센다. 추천 구간은 없다. 많이 나온 구간은 관측일 뿐이다.
"""

from __future__ import annotations

STEP = 0.01
HALF_ROWS = 12          # 내 값 위아래 줄 수. 25줄이면 0.24%p 창이 보인다.
PERIOD = "12개월"
SCOPE = "전국"           # 헤더 필터가 고른 모집단. 첫 출시는 전국만 실데이터라 기본이 전국이다.


def fine_bins(m, bins20: list[float], start: float = 89.90) -> dict[int, float]:
    """0.02 칸을 0.01 두 칸으로 나눈다. 지어낸 분포를 촘촘히 보이려는 것이지 정확도를 주장하지 않는다."""
    out: dict[int, float] = {}
    for i, v in enumerate(bins20):
        base = round((start + i * 0.02) / STEP)
        out[base] = out.get(base, 0.0) + v * 0.55
        out[base + 1] = out.get(base + 1, 0.0) + v * 0.45
    return out


def school_bins(m) -> dict[int, float]:
    out: dict[int, float] = {}
    for row in m.sel_rows():
        k = round(row[3] / STEP)
        out[k] = out.get(k, 0.0) + 1
    return out


def columns(m) -> list[dict]:
    import gen_cohort
    pops = gen_cohort.populations(m)
    cols = []
    for pop in pops[:3]:
        cols.append({"name": pop["name"], "n": pop["n"], "bins": fine_bins(m, pop["bins"]), "state": pop["state"]})
    school = pops[3]
    cols.append({"name": school["name"], "n": school["n"], "bins": school_bins(m), "state": school["state"]})
    return cols


def mode_keys(bins: dict[int, float]) -> tuple[set[int], float]:
    if not bins:
        return set(), 0.0
    peak_k = max(bins, key=bins.get)
    peak = bins[peak_k]
    keys = {peak_k}
    k = peak_k
    while bins.get(k - 1, 0) >= peak / 2:
        k -= 1
        keys.add(k)
    k = peak_k
    while bins.get(k + 1, 0) >= peak / 2:
        k += 1
        keys.add(k)
    share = sum(bins[k] for k in keys) / max(sum(bins.values()), 1) * 100
    return keys, share


def render(m, inner: int) -> str:
    # 헤더 필터가 고른 모집단 한 열만. 네 열 나란히는 지역 크롤이 완결된 뒤로 미룬다.
    every = columns(m)
    cols = [c for c in every if c["name"] == SCOPE] or every[:1]
    my_k = round(m.MY / STEP)
    keys = list(range(my_k + HALF_ROWS, my_k - HALF_ROWS - 1, -1))
    modes = [mode_keys(c["bins"]) for c in cols]
    maxes = [max([c["bins"].get(k, 0) for k in keys] + [1]) for c in cols]
    grid = f"grid-template-columns:84px repeat({len(cols)}, 1fr);"

    def head() -> str:
        cells = "".join(
            '<div style="display:flex; align-items:baseline; gap:6px; padding:0 12px;">'
            f'<span style="font-size:15px; font-weight:600; color:{m.FAINT if c["state"] != "ok" else m.INK};">{c["name"]}</span>'
            f'<span class="lbl" style="color:{m.FAINT if c["state"] != "ok" else m.INK2};">'
            f'{c["n"]:,}회차{" · 표본 적음" if c["state"] == "few" else " · 표본 부족" if c["state"] == "none" else ""}</span></div>'
            for c in cols
        )
        # 기간 스위치는 헤더가 가진다. 이 표는 화면 전체 조건을 따를 뿐이다.
        return (
            f'<div style="display:grid; {grid} align-items:center; padding:8px 0 10px; border-bottom:1px solid {m.LINE};">'
            f'<span class="lbl" style="padding-left:4px;">사정률</span>{cells}</div>'
        )

    def cell(ci: int, k: int) -> str:
        c = cols[ci]
        v = c["bins"].get(k, 0)
        grey = c["state"] != "ok"
        hot = k in modes[ci][0]
        width = v / maxes[ci] * 100
        color = m.FAINT if grey else (m.INK2 if hot else m.BAR)
        num = f"{round(v):,}" if v >= 0.5 else ""
        return (
            '<div style="display:flex; align-items:center; gap:8px; padding:0 12px; min-width:0;">'
            f'<div style="flex:1; height:12px; border-radius:2px; background:transparent; overflow:hidden;">'
            f'<div style="width:{width:.1f}%; height:12px; border-radius:2px; background:{color};"></div></div>'
            f'<span class="num" style="font-size:15px; width:44px; text-align:right; color:{m.FAINT if grey else m.INK};">{num}</span></div>'
        )

    rows = []
    for k in keys:
        mine = k == my_k
        label = f"{k * STEP:.2f}"
        rows.append(
            f'<div style="display:grid; {grid} align-items:center; height:28px;'
            f' background:{m.BLUE_TINT if mine else "transparent"}; border-radius:6px;">'
            f'<span class="num" style="font-size:15px; padding-left:8px; color:{m.BLUE if mine else m.INK2};">'
            f'{label}{" 내 값" if mine else ""}</span>'
            + "".join(cell(ci, k) for ci in range(len(cols))) + "</div>"
        )

    def foot(title: str, values: list[str]) -> str:
        cells = "".join(
            f'<span class="num" style="font-size:15px; padding:0 12px; text-align:right; white-space:nowrap; color:{m.INK};">{v}</span>'
            for v in values
        )
        return (
            f'<div style="display:grid; {grid} align-items:baseline; padding:10px 0; border-top:1px solid {m.LINE};">'
            f'<span class="rl" style="padding-left:4px;">{title}</span>{cells}</div>'
        )

    mode_vals, below_vals = [], []
    for ci, c in enumerate(cols):
        ks, share = modes[ci]
        if c["state"] != "ok" or not ks:
            mode_vals.append(f'<span style="color:{m.FAINT};">—</span>')
            below_vals.append(f'<span style="color:{m.FAINT};">—</span>')
            continue
        lo, hi = min(ks) * STEP, max(ks) * STEP
        mode_vals.append(f'{lo:.2f}~{hi:.2f} <span class="lbl">{share:.0f}%</span>')
        below = sum(v for k, v in c["bins"].items() if k < my_k)
        above = sum(v for k, v in c["bins"].items() if k > my_k)
        below_vals.append(f'{round(below):,} <span class="lbl">위 {round(above):,}</span>')

    more = (
        f'<div style="display:flex; justify-content:center; gap:8px; padding:6px 0;">'
        f'<span class="ghost">위로 더 보기</span><span class="ghost">아래로 더 보기</span></div>'
    )
    return (
        head()
        + f'<div style="display:flex; flex-direction:column; gap:1px;">{"".join(rows)}</div>'
        + more
        + foot("많이 나온 값", mode_vals)
        + foot("내 값보다 낮게 낙찰", below_vals)
        + f'<div class="lbl" style="padding-top:8px;">{m.axis_mod.CATEGORY} · 하한율 90 · {PERIOD} · 08-13 수집분 · 계산 v3 · 진한 막대가 많이 나온 구간</div>'
    )
