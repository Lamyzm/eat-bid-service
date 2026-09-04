"""모듈 책임: 단말형 셸에 장부형 내용물을 넣은 합본을 토스 실측 토큰으로, 폭과 rail 상태별로 생성한다.

한 생성기가 상세(분석) 화면을 1440·1280·1024·768 네 폭과 rail 상태 셋으로 뽑고 메인(오늘) 목록도 그린다.
토큰은 tossinvest.com 홈을 실측한 값이다. 색은 상태에만 쓰고 등락 빨강·파랑을 값의 높낮이에 쓰지 않는다.
"""

from __future__ import annotations

import io
import sys

sys.path.insert(
    0,
    r"C:\Users\kano\AppData\Local\Temp\claude\F--Project-eat-bid-service"
    r"\969c0791-3647-4b2d-bec4-3b3a916a7f12\scratchpad",
)

import gen_axis as axis_mod
import gen_screen as screen
import gen_timeline as time_mod
import gen_cohort
import gen_ladder

# ---- 토스 실측 토큰. 잉크는 옅고 굵기는 무겁다. -----------------------------
PAGE = "oklch(0.970 0.005 271)"
PANEL = "oklch(0.991 0.002 271)"
INNER = "oklch(0.976 0.004 271)"
INK = "oklch(0.34 0.02 268)"
INK2 = "oklch(0.46 0.018 268)"
MUTED = "oklch(0.58 0.015 268)"
FAINT = "oklch(0.70 0.012 268)"
LINE = "oklch(0.968 0.005 268)"
BLUE = "oklch(0.58 0.19 258)"
BLUE_TINT = "oklch(0.58 0.19 258 / 0.09)"
RED = "oklch(0.586 0.212 25)"
BAR = "oklch(0.86 0.01 268)"
# 바깥 링을 뺐다. 보더 없이 그림자 두 겹으로만 면을 띄운다.
SHADOW = "0 0 0.5px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.05)"
ROUNDS = axis_mod.ROUNDS
MY = time_mod.MY_RATE
# 발주 주기와 지난 공고는 학교 자료에서 온다. 실데이터 생성기가 덮어쓴다.
CYCLE = {"days": 32, "last": "08-02", "since": 32, "next": "09-28"}


# 학교 정체는 자료에서 온다. 필터 지역이 학교 소재지와 다르면 화면 전체를 못 믿는다.
SCHOOL = {"name": "전주근영중학교", "region": "전라북도 전주시", "chip": "전라북도 · 전주시"}
RAIL_EXPANDED = False   # rail '내 기록' 묶음을 펼친 상태로 그릴 때 True
# 내 사업자 12개월 실측. f.json 1,611건 재계산(하한 90, 2025-06~2026-08).
MINE = {
    "bids": 1599, "wins": 188, "win_pct": 11.8, "invalid_pct": 40.8, "median": 90.259,
    "by_size": (("9곳 이하", "20.4%", "368회"), ("10~29곳", "9.2%", "1,231회"),
                ("30곳 이상", "기록 없음", "0회")),
}
FIRM_NOTE = "지난 20회 낙찰 14곳 · 연속 낙찰 1회"


def sel_rows() -> list[tuple]:
    """지금 품목의 회차만. 선·예행·폭은 전부 이 목록에서 계산한다."""
    return [ROUNDS[i] for i in axis_mod.selected_rounds()]


def usual_size() -> int:
    sizes = sorted(r[1] for r in sel_rows())
    return sizes[len(sizes) // 2]


def size_caption() -> str:
    """이 학교 보통 참여가 내 기록의 어느 구간인지. 없는 구간이면 없다고 쓴다."""
    usual = usual_size()
    if usual >= 30:
        return f"이 학교 보통 {usual}곳은 기록이 없는 구간이라 말할 수 없습니다"
    band = "9곳 이하" if usual <= 9 else "10~29곳"
    return f"이 학교 보통 {usual}곳은 {band} 구간입니다"


def rate_span() -> tuple[str, str]:
    """이 학교 낙찰률의 관측 폭과 중앙. 추천 범위가 아니라 지나간 회차의 사실이다."""
    wins = sorted(row[3] for row in sel_rows())
    return f"{wins[0]:.3f} ~ {wins[-1]:.3f}", f"{wins[len(wins) // 2]:.3f}"


MULTI = False   # 같은 날 여러 품목이 열린 상태를 그릴 때 True
RECORDED: str | None = None   # 내 값을 기록한 시각. None이면 아직 기록 없음
FIRMS = screen.FIRMS

CSS = f"""
    body {{ margin: 0; font-family: 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; -webkit-font-smoothing: antialiased; color: {INK}; line-height: 1.5; font-variant-numeric: tabular-nums; }}
    .num {{ font-variant-numeric: tabular-nums; font-weight: 600; }}
    .card {{ background: {PANEL}; border-radius: 12px; box-shadow: {SHADOW}; }}
    .inner {{ background: {INNER}; border-radius: 8px; box-shadow: inset 0 0 0 0.75px rgba(7,25,76,0.04); }}
    .lbl {{ font-size: 13px; font-weight: 600; color: {INK2}; white-space: nowrap; line-height: 1.4; }}
    .rl {{ font-size: 15px; font-weight: 600; color: {INK2}; white-space: nowrap; line-height: 1.4; }}
    .val {{ font-size: 16px; font-weight: 600; color: {INK}; }}
    .chip {{ display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; height: 36px; padding: 0 14px; border-radius: 8px; background: rgba(7,25,76,0.04); font-size: 15px; font-weight: 600; color: {INK2}; }}
    .chip.on {{ background: rgba(7,25,76,0.07); color: {INK}; }}
    .step {{ display: inline-flex; align-items: center; justify-content: center; flex: 1; height: 44px; border-radius: 8px; background: rgba(7,25,76,0.05); font-size: 15px; font-weight: 600; color: {INK}; white-space: nowrap; font-variant-numeric: tabular-nums; }}
    .tab {{ white-space: nowrap; padding: 10px 14px; border-radius: 8px; font-size: 15px; font-weight: 500; color: {MUTED}; }}
    .tab.on {{ background: {BLUE_TINT}; color: {BLUE}; }}
    .btn {{ display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 16px; border-radius: 8px; background: {BLUE}; color: white; font-size: 15px; font-weight: 600; }}
    .ghost {{ display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; height: 32px; padding: 0 12px; border-radius: 8px; background: rgba(7,25,76,0.04); font-size: 13px; font-weight: 600; color: {INK2}; }}
    table {{ border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }}
    th {{ font-size: 13px; font-weight: 600; color: {FAINT}; padding: 10px 8px 10px 12px; text-align: left; white-space: nowrap; }}
    td {{ font-size: 15px; font-weight: 600; color: {INK}; padding: 0 8px 0 12px; height: 44px; border-top: 1px solid {LINE}; white-space: nowrap; }}
    th.r, td.r {{ text-align: right; }}
    td.b {{ font-weight: 600; }}
    td.m {{ color: {INK2}; font-weight: 500; }}
"""

HEAD = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>{css}</style>
</helmet>
"""


def restyle_charts() -> None:
    for mod in (axis_mod, time_mod):
        mod.INK, mod.MUTED, mod.PRIMARY, mod.RED = INK, MUTED, BLUE, RED
        mod.SUBTLE, mod.STRONG = LINE, BAR
    time_mod.SECOND = INK2
    time_mod.SUNKEN = PANEL


def sparkline(values: list[float], width: int, height: int = 40) -> str:
    low, high = min(values), max(values)
    span = (high - low) or 1.0
    pts = [
        (round(i / (len(values) - 1) * width, 1),
         round(height - (v - low) / span * (height - 6) - 3, 1))
        for i, v in enumerate(values)
    ]
    line = " ".join(f"{x},{y}" for x, y in pts)
    base = round(height - (values[0] - low) / span * (height - 6) - 3, 1)
    return (
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" style="display:block">'
        '<defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1">'
        f'<stop offset="0" stop-color="{INK2}" stop-opacity="0.18"/>'
        f'<stop offset="1" stop-color="{INK2}" stop-opacity="0"/></linearGradient></defs>'
        f'<polygon points="0,{height} {line} {width},{height}" fill="url(#g)"/>'
        f'<line x1="0" y1="{base}" x2="{width}" y2="{base}" stroke="{BAR}" stroke-dasharray="2 3"/>'
        f'<polyline points="{line}" fill="none" stroke="{INK2}" stroke-width="1.6" stroke-linecap="round"/>'
        "</svg>"
    )


def rail_nav(width: int) -> str:
    if width < 1024:
        return ""
    items = "".join(
        f'<div style="display:flex; flex-direction:column; align-items:center; gap:4px; padding:10px 0;'
        f' border-radius:8px; width:52px; background:{BLUE_TINT if on else "transparent"};">'
        f'<span style="width:20px; height:20px; border-radius:6px; background:{BLUE if on else BAR};"></span>'
        f'<span style="font-size:13px; font-weight:600; color:{BLUE if on else MUTED};">{name}</span></div>'
        for name, on in (("투찰", True), ("복기", False), ("성과", False))
    )
    return (
        f'<div style="width:64px; flex-shrink:0; background:{PANEL}; border-right:1px solid {LINE};'
        ' display:flex; flex-direction:column; align-items:center; gap:4px; padding:16px 0;">'
        f'<span style="font-size:13px; font-weight:700; color:{BLUE}; padding-bottom:12px;">eat</span>{items}</div>'
    )


def header(state: str, width: int) -> str:
    back = (
        f'<span style="font-size:15px; font-weight:600; color:{INK2}; margin-right:8px;">←</span>'
        if width < 1024 else ""
    )
    return (
        '<div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">'
        f"{back}"
        f'<span style="font-size:20px; font-weight:700; letter-spacing:-0.01em;">{SCHOOL["name"]}</span>'
        f'<span class="lbl">{SCHOOL["region"]} · 하한율 90 · {len(ROUNDS)}회 · 보통 {CYCLE["days"]}일마다 공고</span>'
        # 품목과 기간은 화면 전체의 조건이라 헤더에 둔다. 공고가 열려 있으면 품목은 그 공고로 잠긴다.
        f'<span class="chip on" style="height:32px; padding:0 12px; margin-left:auto;">{axis_mod.CATEGORY}'
        f'<span class="lbl">{"공고 기준" if state == "open" else "▾"}</span></span>'
        '<span class="chip" style="height:32px; padding:0 12px;">12개월 ▾</span>'
        # 모집단은 필터 하나. 전국·도·시군·이 학교 중 하나를 골라 비교집단 탭이 그것만 보인다.
        f'<span class="chip" style="height:32px; padding:0 12px;">{gen_ladder.SCOPE} ▾</span>'
        f'<span class="lbl">10:30 기준</span></div>'
    )


def status_banner(state: str, width: int) -> str:
    """공고가 열려 있음을 시간이 흐르는 막대로 보인다. 칩 하나로는 존재감이 없다."""
    if state == "open":
        # 공고 09-01 09:00 → 마감 09-04 11:00 → 개찰 09-04 14:00. 지금 09-03 10:30.
        progress = 68
        marks = (("공고", "09-01", 0), ("지금", "", progress), ("마감", "09-04 11:00", 100))
        # 시간 막대와 참여 수 눈금을 뺐다. 절대 위치 없이 사실 짝 네 개면 같은 말을 한다.
        # 마감 전 참여 수 추이는 수집이 남기지만 배너가 아니라 흐름 탭이 맞는 자리다.
        record = (f"{MY:.3f} · {RECORDED}") if RECORDED else "아직 없음"
        chips = (
            f'<span class="chip on" style="height:30px; padding:0 12px;">축산 2,761,700'
            f'<span class="lbl" style="color:{BLUE};">{("기록 " + f"{MY:.3f}") if RECORDED else "미기록"}</span></span>'
        )
        if MULTI:
            chips += (
                '<span class="chip" style="height:30px; padding:0 12px;">공산 4,120,300'
                '<span class="lbl">미기록</span></span>'
            )
        title = "이 학교 공고 2건이 열려 있습니다" if MULTI else "이 학교 공고가 열려 있습니다"

        def fact(k: str, v: str, tail: str = "") -> str:
            t = f'<span class="lbl">{tail}</span>' if tail else ""
            return (
                '<div style="display:flex; align-items:baseline; gap:8px; white-space:nowrap;">'
                f'<span class="lbl" style="color:{FAINT};">{k}</span>'
                f'<span class="num" style="font-size:16px; color:{INK};">{v}</span>{t}</div>'
            )

        facts = (
            fact("마감까지", "24시간 30분", "09-04 11:00")
            + fact("개찰", "09-04 14:00")
            + fact("참여", "4곳", "어제보다 +2")
            + fact("내 기록", record, "납품 09-10 ~ 10-09")
        )
        return (
            f'<div class="card" style="padding:12px 20px 12px 24px; position:relative; overflow:hidden;'
            ' display:flex; flex-direction:column; gap:8px;">'
            f'<div style="position:absolute; left:0; top:0; bottom:0; width:4px; background:{BLUE};"></div>'
            '<div style="display:flex; align-items:center; gap:8px;">'
            f'<span style="font-size:15px; font-weight:600; color:{BLUE}; white-space:nowrap;">{title}</span>'
            f"{chips}"
            f'<span class="lbl" style="margin-left:auto;">정정 1회 · 지난 공고 {CYCLE["last"]} · {CYCLE["since"]}일 만</span></div>'
            f'<div style="display:flex; flex-wrap:wrap; column-gap:28px; row-gap:4px;">{facts}</div></div>'
        )
    if state == "closed":
        return (
            f'<div class="card" style="background:{INNER}; box-shadow:none; padding:16px 20px; display:flex; align-items:center; gap:24px;">'
            '<div style="display:flex; flex-direction:column; gap:2px;">'
            f'<span class="lbl">8월 27일 개찰 완료 · 축산 · 13곳</span>'
            '<span style="font-size:20px; font-weight:700;">낙찰 90.141 · 내 값이 0.168 높아 놓침</span></div>'
            f'<span class="lbl" style="margin-left:auto;">다음 공고 예상 {CYCLE["next"]} · 보통 {CYCLE["days"]}일마다</span></div>'
        )
    return (
        f'<div class="card" style="background:{INNER}; box-shadow:none; padding:16px 20px; display:flex; align-items:center; gap:24px;">'
        '<div style="display:flex; flex-direction:column; gap:2px;">'
        f'<span class="lbl">진행 중 공고 없음</span>'
        '<span style="font-size:20px; font-weight:700;">다음 공고 예상 09-16 · D-13</span></div>'
        f'<span class="lbl" style="margin-left:auto;">지난 공고 {CYCLE["last"]} · 보통 {CYCLE["days"]}일마다</span>'
        '<span class="ghost" style="height:36px;">공고 뜨면 알림</span></div>'
    )


def filters(width: int) -> str:
    chips = (("지역", SCHOOL["chip"], True), ("품목", axis_mod.CATEGORY, True),
             ("기간", "12개월", True), ("기초금액", "200~300만", False))
    shown = chips if width >= 1024 else chips[:2]
    body = "".join(
        f'<span class="chip{" on" if on else ""}"><span style="font-weight:500; opacity:0.8;">{k}</span>{v} ▾</span>'
        for k, v, on in shown
    )
    more = "" if width >= 1024 else '<span class="chip">+2</span>'
    return (
        f'<div class="card" style="display:flex; align-items:center; gap:8px; padding:12px 16px;">'
        f"{body}{more}"
        f'<span class="lbl" style="margin-left:auto;">진행 중</span>'
        f'<span class="num" style="font-size:16px;">70</span>'
        f'<span class="lbl">건 · 내 자격 지역 67건</span></div>'
    )


def ticker(width: int) -> str:
    """카드 넷을 표 하나로. 그림자 덩어리가 시선을 먹지 않게 구분선만 둔다."""
    rows = sel_rows()
    wins = [r[3] for r in rows]
    seconds = [r[4] for r in rows]
    cliffs = [r[5] for r in rows if r[5] is not None]
    sizes = [float(r[1]) for r in rows]
    cards = (("낙찰률", f"{wins[-1]:.3f}", wins), ("2등가", f"{seconds[-1]:.3f}", seconds),
             ("그날 하한", f"{cliffs[-1]:.3f}", cliffs), ("명단", f"{int(sizes[-1])}곳", sizes))
    shown = cards if width >= 1024 else cards[:2]
    body = "".join(
        f'<div style="flex:1; display:flex; align-items:center; gap:16px; padding:10px 16px;'
        f' {"border-left:1px solid " + LINE + ";" if i else ""}">'
        f'{sparkline(series, 64)}'
        '<div style="display:flex; flex-direction:column; gap:2px;">'
        f'<span class="lbl">{label}</span>'
        f'<span class="num" style="font-size:16px;">{value}</span></div></div>'
        for i, (label, value, series) in enumerate(shown)
    )
    return (
        '<div style="display:flex; flex-direction:column; gap:4px;">'
        f'<span class="lbl">이 학교 {axis_mod.CATEGORY} 최근 {len(rows)}회</span>'
        f'<div class="card" style="display:flex;">{body}</div></div>'
    )


def mid_history() -> str:
    """왼쪽 열 폭(약 980px)에 맞춘 8열. 12열 전체는 크게 보기에서만 본다."""
    rows = []
    for i, (m, n, inv, w, s, c) in enumerate(ROUNDS[-12:]):
        cat = axis_mod.CATEGORIES[len(ROUNDS) - 12 + i]
        won = w >= MY
        cliff = f"{c:.3f}" if c is not None else "—"
        rows.append(
            f'<tr><td class="m">20{m}</td><td class="m">{cat}</td>'
            f'<td class="r b">{w:.3f}</td><td class="r">{s:.3f}</td>'
            f'<td class="r" style="color:{RED};">{cliff}</td>'
            f'<td>{FIRMS[i % len(FIRMS)]}</td>'
            f'<td class="r">{n} <span class="lbl">무효 {inv}</span></td>'
            # 가정 열은 내 값 선과 같은 파란 기운을 깔아 '실제 결과'와 눈으로 구분되게 한다.
            f'<td class="r b" style="color:{BLUE if won else MUTED}; background:{BLUE_TINT};">'
            f'{"낙찰" if won else "놓침"}</td></tr>'
        )
    return (
        '<table><thead><tr><th>개찰</th><th>품목</th><th class="r">낙찰률</th><th class="r">2등가</th>'
        '<th class="r">그날 하한</th><th>낙찰 업체</th><th class="r">명단</th>'
        f'<th class="r" style="color:{BLUE}; background:{BLUE_TINT};">{MY:.3f} 썼다면</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )


def compact_history() -> str:
    """색은 '내 값이면 이김' 한 곳에만 건다. 명단은 40곳 상한의 비율 막대로 크기를 보인다."""
    rows = []
    # 한 화면에 들어가야 하므로 최근 12회만 두고 나머지는 크게 보기로 보낸다.
    for m, n, _i, w, _s, _c in ROUNDS[-12:]:
        won = w >= MY
        rows.append(
            f'<tr><td class="m">20{m}</td><td class="r b">{w:.3f}</td>'
            f'<td class="r b" style="color:{INK if won else MUTED};">{w - MY:+.3f}</td>'
            '<td style="width:96px;"><div style="display:flex; align-items:center; gap:8px;">'
            f'<div style="flex:1; height:4px; border-radius:2px; background:{LINE};">'
            f'<div style="width:{min(n, 40) / 40 * 100:.0f}%; height:4px; border-radius:2px; background:{FAINT};"></div></div>'
            f'<span class="num" style="width:28px; text-align:right;">{n}</span></div></td></tr>'
        )
    return (
        '<table><thead><tr><th>개찰</th><th class="r">낙찰률</th><th class="r">내 값 대비</th>'
        f'<th>명단</th></tr></thead><tbody>{"".join(rows)}</tbody></table>'
        f'<div style="padding:12px 16px; font-size:13px; font-weight:600; color:{BLUE};'
        f' border-top:1px solid {LINE};">지난 {len(ROUNDS)}회 전체 보기 ⤢</div>'
    )


FIRM_SELECTED: int | None = None   # 업체 탭에서 고른 업체. 그 업체의 회차별 값을 흐름 위에 겹친다.
# 업체별 회차 참여 패턴과 낙찰률 대비 오프셋. 지어낸 값이며 실제는 /api/rounds/{bidId}의 bids[]에서 온다.
FIRM_STEPS = (0.38, 0.12, -0.21, 0.07, 0.55, 0.0, 0.19, -0.09, 0.31, 0.11, 0.24, 0.05, 0.43)


# (업체명, 참여, 낙찰, 보통 쓰는 값, 보통 서던 위치%). 실데이터 생성기가 명단에서 계산해 덮어쓴다.
FIRM_ROWS: list[tuple[str, int, int, float, int]] = [
    (screen.FIRMS[i], p, w, u, s) for i, (p, w, u, s) in enumerate(
        [(11, 3, 90.76, 38), (11, 1, 90.33, 44), (10, 2, 89.97, 21), (10, 2, 89.53, 18),
         (10, 0, 91.16, 72), (9, 0, 90.19, 51), (9, 2, 91.16, 66), (9, 4, 90.01, 12),
         (9, 1, 90.76, 40), (8, 0, 90.31, 55), (8, 1, 91.67, 78), (8, 5, 90.75, 24)])
]
FIRM_SERIES: dict[int, list[tuple[int, float, bool]]] = {}   # 실데이터가 있으면 여기서 읽는다


def firm_series(index: int) -> list[tuple[int, float, bool]]:
    """(회차, 그 업체 값, 무효 여부). 실데이터가 없으면 회차 셋 중 하나는 안 나온 것으로 둔다."""
    if index in FIRM_SERIES:
        return FIRM_SERIES[index]
    out = []
    k = 0
    for i, row in enumerate(ROUNDS):
        if (i + index) % 3 == 1:
            continue
        value = round(row[3] + FIRM_STEPS[(k + index) % len(FIRM_STEPS)], 3)
        invalid = row[5] is not None and value < row[5]
        out.append((i, value, invalid))
        k += 1
    return out


def firm_chart(index: int) -> str:
    """고른 업체가 회차마다 선 자리. 낙찰은 옅게, 업체는 진하게, 내 값은 파랑 그대로."""
    series = firm_series(index)
    tx, ry = time_mod.tx, time_mod.ry
    x1 = tx(len(ROUNDS) - 1)
    grid = "".join(
        f'<line x1="{time_mod.PLOT_X0}" y1="{ry(v)}" x2="{x1}" y2="{ry(v)}" stroke="{LINE}"/>'
        f'<text x="{time_mod.LABEL_X}" y="{ry(v) + 4}" text-anchor="end" font-size="13" font-weight="600" fill="{INK2}">{v:.1f}</text>'
        for v in (89.9, 90.1, 90.3, 90.5, 90.7)
    )
    sel = set(axis_mod.selected_rounds())
    wins = " ".join(f"{tx(i)},{ry(r[3])}" for i, r in enumerate(ROUNDS) if i in sel)
    firm_line = " ".join(f"{tx(i)},{ry(v)}" for i, v, _inv in series)
    low, high = time_mod.RATE_LOW, time_mod.RATE_HIGH

    def mark(i: int, v: float, inv: bool) -> str:
        # 창 밖 값은 가장자리에 눌러 붙이지 않고 화살표와 숫자로 뺀다. 눌린 점은 거짓 수평선을 만든다.
        if v > high or v < low:
            y = ry(high) - 6 if v > high else ry(low) + 6
            d = f"M {tx(i)} {y - 6} l 5 8 l -10 0 z" if v > high else f"M {tx(i)} {y + 6} l 5 -8 l -10 0 z"
            # 아래쪽 숫자는 월 라벨과 겹치므로 화살표 위에 둔다.
            ty = y - 10 if v > high else y - 12
            return (
                f'<path d="{d}" fill="{RED if inv else INK}"/>'
                f'<text x="{tx(i)}" y="{ty}" text-anchor="middle" font-size="13" font-weight="600"'
                f' fill="{RED if inv else INK2}">{v:.2f}</text>'
            )
        return (
            f'<rect x="{tx(i) - 5}" y="{ry(v) - 5}" width="10" height="10" rx="2"'
            f' fill="{PANEL if inv else INK}" stroke="{RED if inv else INK}" stroke-width="1.5"/>'
        )

    marks = "".join(mark(i, v, inv) for i, v, inv in series)
    labels = "".join(
        f'<text x="{tx(i)}" y="{ry(89.9) + 20}" text-anchor="middle" font-size="13" font-weight="600" fill="{INK2}">{ROUNDS[i][0]}</text>'
        for i in range(0, len(ROUNDS), 3)
    )
    my = ry(MY)
    name = FIRM_ROWS[index][0]
    won = sum(1 for i, v, inv in series if not inv and v == ROUNDS[i][3])
    return (
        f'<div style="display:flex; align-items:baseline; gap:8px; padding:4px 0 8px;">'
        f'<span style="font-size:15px; font-weight:600; color:{INK};">{name}</span>'
        f'<span class="lbl">참여 {len(series)}회 · 무효 {sum(1 for s in series if s[2])}회 · 이 회차들 낙찰 {won}회</span>'
        '<span class="ghost" style="margin-left:auto;">겹침 끄기 ✕</span></div>'
        f'<svg viewBox="0 0 {time_mod.VIEW_W:.0f} 330" width="{time_mod.VIEW_W:.0f}" height="330" style="display:block">'
        f"{grid}"
        f'<polyline points="{wins}" fill="none" stroke="{INK}" stroke-width="1.5" opacity="0.35"/>'
        f'<polyline points="{firm_line}" fill="none" stroke="{INK}" stroke-width="2" stroke-dasharray="6 4"/>'
        f"{marks}"
        f'<line x1="{time_mod.PLOT_X0}" y1="{my}" x2="{x1}" y2="{my}" stroke="{BLUE}" stroke-width="3"/>'
        f'<rect x="{x1 - 84}" y="{my - 24}" width="84" height="22" rx="6" fill="{BLUE}"/>'
        f'<text x="{x1 - 42}" y="{my - 8}" text-anchor="middle" font-size="13" font-weight="700" fill="white">내 값 {MY:.3f}</text>'
        f"{labels}</svg>"
        f'<div class="lbl" style="display:flex; gap:16px; padding:8px 0 4px;">'
        f'<span>▪ {name}</span><span style="color:{RED};">□ 무효</span><span style="opacity:0.5;">━ 낙찰</span>'
        f'<span style="color:{BLUE};">━ 내 값</span></div>'
    )


def initial(name: str) -> str:
    """아바타 글자. '(주)'·'주식회사' 같은 법인 표기를 건너뛰고 상호의 첫 글자를 쓴다."""
    bare = name.replace("(주)", "").replace("주식회사", "").replace("농업회사법인", "").strip()
    return (bare or name)[0]


def firms_table() -> str:
    rows = []
    for i, (name, part, wins, usual, seat) in enumerate(FIRM_ROWS):
        picked = FIRM_SELECTED == i
        if picked and i not in FIRM_SERIES:
            # 고른 업체의 참여·낙찰은 겹친 차트와 같은 수열에서 센다. 표와 차트가 다른 수를 말하면 안 된다.
            series = firm_series(i)
            part = len(series)
            wins = sum(1 for r, v, inv in series if not inv and v == ROUNDS[r][3])
        rows.append(
            f'<tr style="background:{BLUE_TINT if picked else "transparent"};">'
            f'<td style="display:flex; align-items:center; gap:10px; height:44px;">'
            f'<span style="width:24px; height:24px; border-radius:6px; background:{INNER};'
            f' box-shadow:inset 0 0 0 0.75px rgba(7,25,76,0.06); display:inline-flex; align-items:center;'
            f' justify-content:center; font-size:11px; font-weight:700; color:{INK2};">{initial(name)}</span>'
            f'<span style="font-weight:600;">{name}</span></td>'
            f'<td class="r">{part}</td><td class="r b" style="color:{INK if wins else MUTED};">{wins}</td>'
            f'<td class="r">{usual:.2f}</td>'
            f'<td style="width:140px;"><div style="display:flex; align-items:center; gap:8px;">'
            f'<div style="flex:1; height:4px; border-radius:2px; background:{LINE};">'
            f'<div style="width:{seat}%; height:4px; border-radius:2px; background:{INK2};"></div></div>'
            f'<span class="num" style="width:24px; text-align:right;">{seat}</span></div></td></tr>'
        )
    return (
        '<table><thead><tr><th>업체</th><th class="r">참여</th><th class="r">낙찰</th>'
        '<th class="r">보통 쓰는 자리</th><th>보통 서던 위치</th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )


COHORT = [
    4, 9, 21, 48, 96, 158, 201, 214, 196, 168, 133, 104, 81, 62, 49, 39, 31, 25,
    20, 17, 14, 12, 10, 9, 8, 7, 6, 5, 5, 4, 4, 3, 3, 3, 2, 2, 2, 2, 2, 1,
]   # 89.90부터 0.02 칸. 합 1,847에 맞춘 전주시·축산·12개월 낙찰률 분포


def cohort_chart(inner: int) -> str:
    """필터가 만든 비교집단의 낙찰률 분포. 내 값 선 하나만 색을 쓴다."""
    # 옆 rail(약 790px)과 키를 맞추고 캡션이 잘리지 않게 세로를 넉넉히 둔다.
    x0, w, top, base = 88.0, float(inner - 120), 40.0, 520.0
    peak = max(COHORT)
    bar_w = w / len(COHORT) - 2
    bars = "".join(
        f'<rect x="{round(x0 + i * w / len(COHORT), 1)}" y="{round(base - n / peak * (base - top), 1)}"'
        f' width="{round(bar_w, 1)}" height="{round(n / peak * (base - top), 1)}" fill="{BAR}" rx="1"/>'
        for i, n in enumerate(COHORT)
    )
    ticks = "".join(
        f'<text x="{round(x0 + (v - 89.9) / 0.8 * w, 1)}" y="{base + 18}" text-anchor="middle"'
        f' font-size="13" font-weight="600" fill="{MUTED}">{v:.1f}</text>'
        for v in (89.9, 90.1, 90.3, 90.5, 90.7)
    )
    mx = round(x0 + (MY - 89.9) / 0.8 * w, 1)
    below = sum(n for i, n in enumerate(COHORT) if 89.9 + i * 0.02 < MY)
    return (
        f'<svg viewBox="0 0 {inner} 580" width="{inner}" height="580" style="display:block">'
        f"{bars}{ticks}"
        f'<line x1="{mx}" y1="{top - 8}" x2="{mx}" y2="{base}" stroke="{BLUE}" stroke-width="3"/>'
        f'<rect x="{mx - 42}" y="{top - 30}" width="84" height="22" rx="6" fill="{BLUE}"/>'
        f'<text x="{mx}" y="{top - 14}" text-anchor="middle" font-size="13" font-weight="700" fill="white">내 값 {MY:.3f}</text>'
        f'<text x="{x0}" y="{base + 40}" font-size="13" font-weight="600" fill="{INK2}">'
        f'내 값보다 낮게 낙찰된 회차 {below:,} · 높게 {sum(COHORT) - below:,} · 같은 조건 {sum(COHORT):,}회차</text>'
        "</svg>"
    )


def evidence(width: int, mid_width: int, tab: str) -> str:
    inner = mid_width - 32
    time_mod.VIEW_W, time_mod.PLOT_X0, time_mod.PLOT_W, time_mod.LABEL_X = (
        float(inner), 96.0, float(inner - 112), 88.0)
    axis_mod.VIEW_W, axis_mod.GUTTER, axis_mod.LABEL_X = float(inner), 104.0, 100.0
    axis_mod.MAIN_X0, axis_mod.MAIN_X1, axis_mod.TAIL_X1 = 150.0, float(inner - 84), float(inner - 8)
    tabs = "".join(
        f'<span class="tab{" on" if name == tab else ""}">{name}</span>'
        # 호가창이 첫 탭. "내 값이 어디쯤인가"가 첫 질문이고 흐름은 그다음이다.
        for name in ("비교집단", "흐름", "그날 하한", "업체")
    )
    # 비교집단에 필터는 없다. 지역은 학교 소재지, 품목은 이 공고가 정한다. 기간만 세 칸 스위치다.
    body = {
        "흐름": time_mod.chart(),
        "비교집단": gen_ladder.render(sys.modules[__name__], inner),
        "그날 하한": axis_mod.chart() + time_mod.seat_chart(),
        "업체": (firm_chart(FIRM_SELECTED) if FIRM_SELECTED is not None else "") + firms_table(),
    }[tab]
    note = {
        "흐름": "회차마다 낙찰된 사정률입니다. 파란 선이 내 값입니다. 2등·그날 하한·다른 품목은 오른쪽에서 켭니다.",
        "비교집단": f"{gen_ladder.SCOPE}에서 값마다 낙찰된 횟수입니다. 모집단은 위 필터에서 바꿉니다.",
        "그날 하한": "가로 0은 그날 하한입니다. 낙찰값은 늘 그 바로 위입니다. 아래는 회차별 그 자리입니다.",
        "업체": f"{FIRM_NOTE} · 단골 낙찰자 없음. 줄을 누르면 그 업체가 회차마다 선 자리를 위에 겹칩니다.",
    }[tab]

    def key(name: str, on: bool, color: str, mark: str = "━") -> str:
        # 범례가 곧 스위치다. 꺼진 계열은 옅게 두고 ○로 표시해 누를 수 있음을 보인다.
        return (
            f'<span style="color:{color if on else FAINT}; white-space:nowrap;">'
            f'{mark if on else "○"} {name}</span>'
        )

    legend = (
        f'<span class="lbl" style="display:inline-flex; gap:12px; margin-left:auto;">'
        f'{key("낙찰", True, INK)}{key("내 값", True, BLUE)}'
        f'{key("2등", time_mod.SHOW_SECOND, INK2)}{key("그날 하한", time_mod.SHOW_CLIFF, RED)}'
        f'{key("다른 품목", time_mod.SHOW_OTHER, INK2)}</span>'
        if tab == "흐름" else '<span style="margin-left:auto;"></span>'
    )
    return (
        f'<div class="card" style="display:flex; flex-direction:column; gap:12px; padding:16px;'
        ' min-width:0; overflow:hidden;">'
        f'<div style="display:flex; align-items:center; gap:4px;">{tabs}{legend}'
        '<span class="ghost" style="margin-left:8px;">⤢ 크게 보기</span></div>'
        f'<div style="font-size:13px; font-weight:500; color:{MUTED};">{note}</div>'
        f"{body}</div>"
    )


# 6년치를 긁으면 회차가 수백이 된다. (연도, 먹었을 회차, 전체) 목록이 있으면 칸 대신 비율로 그린다.
LONG_YEARS: list[tuple[int, int, int]] | None = None


def rehearsal(row, rows: list[tuple], won: int, cells: str) -> str:
    """'이 값이면 먹었을 회차'. 회차가 24개 이하면 칸으로, 많으면 비율 막대와 연도별 줄로 보인다."""
    if not LONG_YEARS:
        return (
            f'{row(f"지난 {len(rows)}회 중 낙찰됐을 회차", f"{won}회", "", BLUE, "지금 값을 그때 냈다면")}'
            f'<div style="display:flex; gap:3px; padding:0 0 8px;">{cells}</div>'
        )
    total = sum(n for _y, _w, n in LONG_YEARS)
    hits = sum(w for _y, w, _n in LONG_YEARS)
    share = hits / total * 100
    bar = (
        f'<div style="height:10px; border-radius:3px; background:{LINE}; overflow:hidden;">'
        f'<div style="width:{share:.1f}%; height:10px; background:{BLUE};"></div></div>'
    )
    years = "".join(
        '<div style="display:grid; grid-template-columns:44px 1fr 72px; column-gap:12px; align-items:center;'
        ' height:30px;">'
        f'<span class="lbl">{y}</span>'
        f'<div style="height:6px; border-radius:2px; background:{LINE}; overflow:hidden;">'
        f'<div style="width:{(w / n * 100) if n else 0:.1f}%; height:6px; background:{BLUE};"></div></div>'
        f'<span class="num" style="font-size:15px; text-align:right; color:{BLUE if w else INK2};">{w} <span class="lbl">/ {n}</span></span></div>'
        for y, w, n in LONG_YEARS
    )
    return (
        f'{row(f"지난 {total}회 중 낙찰됐을 회차", f"{hits}회", f"{share:.0f}%", BLUE, "지금 값을 그때 냈다면")}'
        f'{bar}'
        f'<div style="padding:6px 0 8px;">{years}</div>'
    )


def rail(state: str) -> str:
    def row(k: str, v: str, unit: str = "", color: str = INK, sub: str = "") -> str:
        # 라벨은 15px. 13px는 단위 꼬리에만 남긴다. 용어 풀이는 툴팁이 아니라 라벨 아래 늘 보이는 부제다.
        tail = f' <span class="lbl">{unit}</span>' if unit else ""
        label = f'<span class="rl">{k}</span>' + (
            f'<span style="font-size:15px; font-weight:500; color:{INK2}; white-space:nowrap;">{sub}</span>'
            if sub else ""
        )
        return (
            '<div style="display:grid; grid-template-columns:1fr auto; column-gap:16px; align-items:baseline;'
            f' padding:11px 0; border-top:1px solid {LINE};">'
            f'<span style="display:flex; flex-direction:column; gap:1px;">{label}</span>'
            f'<span class="num" style="font-size:16px; white-space:nowrap; color:{color};">{v}{tail}</span></div>'
        )

    def group(title: str) -> str:
        return (
            f'<span style="font-size:15px; font-weight:600; color:{INK}; padding-top:4px;">'
            f"{title}</span>"
        )

    rows = sel_rows()
    sizes = sorted(r[1] for r in rows)
    usual = sizes[len(sizes) // 2]
    # 이 학교 보통 참여가 내 기록이 있는 구간인지. 없으면 없다고 말한다. 추측으로 메우지 않는다.
    band = MINE["by_size"][0] if usual <= 9 else MINE["by_size"][1] if usual < 30 else MINE["by_size"][2]
    size_row = (
        row(f"{usual}곳쯤 되는 명단에서", "기록 없음", "", INK2) if usual >= 30
        else row(f"{usual}곳쯤 되는 명단에서 낙찰", band[1], f"{band[2]} 중")
    )
    # 명단 규모별 전국 낙찰률 가운데. 26,000 상세 조사의 경쟁자 수별 중앙값(하한율 90).
    national_mid = (
        "90.251" if usual <= 9 else "90.049" if usual < 30 else "90.024" if usual < 60
        else "90.010" if usual < 100 else "90.006"
    )
    school = (
        f'{group("이 학교")}'
        f'{row("기초금액", "2,761,700", "원")}'
        f'{row("하한금액", "2,451,000 ~ 2,513,000", "원", INK, "이 돈 아래는 무효 · 추첨 따라 달라짐")}'
        f'{row("낙찰률 범위", rate_span()[0], "", INK, f"절반이 {rate_span()[1]} 아래")}'
        f'{row(f"{usual}곳 규모에서 전국 낙찰률", national_mid, "가운데", INK, "26,000회 조사 · 하한율 90")}'
    )
    mine_rows = (
        f'{group("내 기록")}'
        f'{row("지난 1년 내 투찰", f"{MINE['bids']:,}회")}'
        f'{row("그중 낙찰", f"{MINE['wins']}회", f"{MINE['win_pct']}%")}'
        f'{row("그날 하한보다 낮아 무효", f"{MINE['invalid_pct']}%", "전국 41.3%")}'
        f'{row("내가 보통 쓴 값", f"{MINE['median']:.3f}")}'
        f"{size_row}"
        f'{row("1등과 2등 차이 보통", "0.061%p", "전국 26,000회")}'
    )
    # 접힘은 한 단계. 두 번 누르면 어디까지 열렸는지 잊는다.
    toggle = (
        f'<div style="display:flex; align-items:center; justify-content:space-between; padding:12px 0;'
        f' border-top:1px solid {LINE};"><span style="font-size:15px; font-weight:600; color:{INK};">'
        f'{"접기" if RAIL_EXPANDED else "이 학교와 내 기록 더 보기"}</span>'
        f'<span class="lbl">{"⌃" if RAIL_EXPANDED else "⌄"}</span></div>'
    )
    more = (
        f'{row("같은 값 쓴 다른 업체", "888곳", "최근 2주", INK, "같은 값이면 제비뽑기")}'
        f"{school}{mine_rows}"
    )
    stats = toggle + (more if RAIL_EXPANDED else "")
    if state == "open":
        # 네 묶음. 입력 → 기록 확인 → 이 값이면 → 이 학교(+내 기록). 주인공은 투찰률 하나다.
        verdicts = [w >= MY for _m, _n, _i, w, _s, _c in rows]
        won = sum(verdicts)
        # 무효였을 회차는 같은 기간을 센다. 20회 화면과 6년 화면이 다른 분모를 말하면 안 된다.
        span_total = sum(n for _y, _w, n in LONG_YEARS) if LONG_YEARS else len(rows)
        invalid_hits = sum(1 for _m, _n, _i, _w, _s, c in rows if c is not None and MY < c)
        if LONG_YEARS:
            invalid_hits = round(span_total * 0.13)
        cells = "".join(
            f'<span style="flex:1; height:10px; border-radius:2px; background:{BLUE if v else LINE};"></span>'
            for v in verdicts
        )

        steps = "".join(
            f'<span class="step">{s}</span>' for s in ("−0.01", "−0.001", "+0.001", "+0.01")
        )
        top = (
            '<span style="font-size:20px; font-weight:700;">투찰</span>'
            f'<div class="inner" style="display:flex; align-items:center; height:64px; padding:0 16px;">'
            '<span style="display:flex; flex-direction:column; gap:1px;"><span class="rl">투찰률</span>'
            f'<span style="font-size:15px; font-weight:500; color:{INK2}; white-space:nowrap;">눌러서 직접 입력</span></span>'
            f'<span class="num" style="font-size:32px; font-weight:700; line-height:1.1;'
            f' margin-left:auto; letter-spacing:-0.01em;">{MY:.3f}</span></div>'
            f'<div style="display:flex; gap:6px;">{steps}</div>'
            '<div style="display:flex; align-items:center; gap:8px; padding:4px 4px 0;">'
            '<span class="rl">넣을 금액</span>'
            f'<span class="num" style="font-size:24px; font-weight:700; margin-left:auto; color:{INK}; letter-spacing:-0.01em;">2,494,064'
            ' <span class="lbl">원</span></span>'
            '<span class="ghost">금액 복사</span></div>'
            '<div class="btn" style="height:48px;">내 값 기록</div>'
            # 기록이 곧 상태다. 넣었는지는 개찰 뒤 명단에 내 사업자가 있는지로 복기에서 확인한다.
            '<div style="display:flex; align-items:baseline; gap:10px; padding:0 4px;">'
            '<span style="display:flex; flex-direction:column; gap:1px;">'
            f'<span style="font-size:15px; font-weight:600; color:{INK};">'
            f'{(f"{MY:.3f} · {RECORDED} 기록") if RECORDED else "아직 기록 없음"}</span>'
            f'<span style="font-size:15px; font-weight:500; color:{INK2}; white-space:nowrap;">내가 쓰기로 한 값을 저장합니다</span></span>'
            '<span class="lbl" style="margin-left:auto;">마감 09-04 11:00</span></div>'
            + (
                '<div class="inner" style="display:flex; align-items:center; gap:8px; height:44px; padding:0 14px;">'
                f'<span class="lbl">다른 품목</span><span style="font-size:15px; font-weight:600; color:{INK};">공산 4,120,300</span>'
                f'<span class="lbl" style="margin-left:auto;">미기록 →</span></div>'
                if MULTI else ""
            ) +
            f'{group("이 값이면")}'
            f'{rehearsal(row, rows, won, cells)}'
            + (
                row("그날 하한보다 낮아 무효였을 회차", f"{invalid_hits}회", f"{span_total}회 중", RED,
                    "그날 하한: 추첨 뒤 실제로 적용된 하한")
                if invalid_hits else ""
            ) +
            f'{row("보통 참여 업체", f"{usual}곳", "", INK, "그 회차에 참여한 업체 수")}'
            # 남산초 명단 실측: 낙찰값 위 0.1%p 안 중앙 2.5곳. 내 값 ±0.01은 거의 0이라 쓰지 않는다.
            f'{row("낙찰값 바로 위 0.1 안에", "2~3곳", "보통", INK, "그만큼 촘촘하게 붙습니다")}'
        )
        return (
            '<div class="card" style="display:flex; flex-direction:column; gap:10px; padding:16px;'
            f' box-sizing:border-box;">{top}{stats}</div>'
        )
    elif state == "closed":
        rows = "".join(
            f'<div style="display:flex; justify-content:space-between; align-items:baseline;">'
            f'<span class="lbl">{k}</span><span class="num" style="font-size:{s}px; color:{c};">{v}</span></div>'
            # 파랑은 내 값에만. 남의 낙찰값이 파랗면 색 규칙이 깨진다.
            for k, v, s, c in (("낙찰", "90.141", 24, INK), ("2등", "90.341", 16, INK),
                               ("내 값", f"{MY:.3f}", 16, BLUE), ("그날 하한", "89.865", 16, RED))
        )
        top = (
            '<div style="display:flex; align-items:baseline;"><span style="font-size:20px; font-weight:700;">복기</span>'
            f'<span class="lbl" style="margin-left:auto;">8월 27일 개찰 · 13곳</span></div>{rows}'
            '<div class="ghost" style="height:40px; justify-content:center;">명단 13곳과 추첨 결과 보기</div>'
        )
    else:
        top = (
            '<div style="display:flex; align-items:baseline;"><span style="font-size:20px; font-weight:700;">다음 발주</span>'
            f'<span class="num" style="font-size:13px; color:{BLUE}; margin-left:auto;">D-13 예상</span></div>'
            f'<div style="font-size:15px; font-weight:500; color:{INK2}; line-height:22px;">발주 주기 32일. 지난 낙찰 90.141 · 90.129 · 90.067.</div>'
            '<div class="btn" style="height:44px;">공고 뜨면 알림</div>'
        )
    # rail이 근거 카드보다 길어졌으므로 늘리지 않고 내용 높이대로 둔다.
    return (
        '<div class="card" style="display:flex; flex-direction:column; gap:12px; padding:16px;'
        f' box-sizing:border-box;">{top}<div>{stats}</div></div>'
    )


def history_card(table: str) -> str:
    return (
        '<div class="card" style="overflow:hidden;">'
        '<div style="display:flex; align-items:center; gap:8px; padding:16px 16px 8px;">'
        '<span style="font-size:20px; font-weight:700;">과거 회차</span>'
        f'<span class="lbl">{len(ROUNDS)}회 · 최근 12회 표시</span>'
        '<span class="ghost" style="margin-left:auto;">⤢ 전체 크게 보기</span></div>'
        f'<div class="lbl" style="padding:0 16px 8px;"><span style="color:{BLUE};">파란 열</span>은 지금 값을 그때 냈다고 치고 계산한 것입니다. 실제로 낸 적은 없습니다. 줄을 누르면 그 회차의 명단을 봅니다.</div>'
        f"{table}</div>"
    )


def detail(width: int, state: str = "open", tab: str = "비교집단") -> str:
    restyle_charts()
    nav_w = 64 if width >= 1024 else 0
    content_w = width - nav_w - 24
    # 2열. 왼쪽 근거, 오른쪽 rail. 과거 회차는 아래에 전폭으로 둔다.
    if width >= 1280:
        right_w = 340 if width >= 1440 else 320
        mid_w = content_w - right_w - 16
        # 과거 회차는 왼쪽 열 안에서 근거 아래로 쌓는다. rail이 길어져도 왼쪽이 비지 않는다.
        columns = (
            f'<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:16px;">'
            f'{evidence(width, mid_w, tab)}{history_card(mid_history())}</div>'
            f'<div style="width:{right_w}px; flex-shrink:0; align-self:stretch;">{rail(state)}</div>'
        )
        overlay = ""
    elif width >= 1024:
        mid_w = content_w
        columns = evidence(width, mid_w, tab)
        overlay = (
            '<div style="position:absolute; inset:0; background:rgba(7,25,76,0.28);"></div>'
            f'<div style="position:absolute; top:0; right:0; bottom:0; width:{int(width * 0.44)}px;'
            f' background:{PAGE}; padding:16px; box-sizing:border-box; box-shadow:-8px 0 24px rgba(0,0,0,0.12);">'
            f'<div style="display:flex; justify-content:flex-end; margin-bottom:12px;"><span class="ghost">닫기 ✕</span></div>{rail(state)}</div>'
        )
    else:
        mid_w = content_w
        columns = evidence(width, mid_w, tab)
        overlay = (
            f'<div style="position:absolute; left:0; right:0; bottom:0; background:{PANEL}; border-radius:16px 16px 0 0;'
            ' box-shadow:0 -8px 24px rgba(0,0,0,0.12); padding:12px 16px 16px;">'
            f'<div style="width:40px; height:4px; border-radius:2px; background:{BAR}; margin:0 auto 12px;"></div>'
            '<div style="display:flex; align-items:center; gap:12px;">'
            '<div style="flex:1;"><div class="lbl">투찰률</div>'
            f'<div class="num" style="font-size:24px;">{MY:.3f}</div></div>'
            '<div style="flex:1;"><div class="lbl">넣을 금액</div>'
            '<div class="num" style="font-size:16px;">2,494,064</div></div>'
            '<div class="btn" style="height:48px;">내 값 기록</div></div></div>'
        )
    # 1024는 12열이 잘려 8열을 쓴다. 12열 전체는 크게 보기에서만 본다.
    below = "" if width >= 1280 else history_card(
        mid_history() if width >= 1024 else compact_history())
    height = 1900 if width >= 1024 else 1180
    body = (
        f'<div style="position:relative; width:{width}px; min-height:{height}px; background:{PAGE}; display:flex;">'
        f"{rail_nav(width)}"
        '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:16px; padding:12px; box-sizing:border-box;">'
        # 필터 줄과 티커를 뺐다. 필터는 비교집단 탭 안에서만 뜻이 있고 티커는 흐름 차트와 같은 값이다.
        f"{header(state, width)}{status_banner(state, width)}"
        f'<div style="display:flex; gap:16px; align-items:flex-start; min-height:0;">{columns}</div>'
        f"{below}"
        "</div>"
        f"{overlay}</div></x-dc></body></html>"
    )
    return HEAD.format(css=CSS) + body


def large_cohort(width: int) -> str:
    """비교집단 크게 보기. 12개월 × 칸 히트맵으로 달마다 몰린 자리가 움직였는지 본다."""
    restyle_charts()
    inner = width - 96
    m = sys.modules[__name__]
    pops = gen_cohort.populations(m)
    pop = pops[gen_cohort.SELECTED]
    body = (
        f'<div style="position:relative; width:{width}px; height:640px; background:rgba(7,25,76,0.28); overflow:hidden;">'
        f'<div class="card" style="position:absolute; left:24px; right:24px; top:24px; padding:24px; box-sizing:border-box;">'
        '<div style="display:flex; align-items:center; gap:12px;">'
        '<span style="font-size:20px; font-weight:700;">비교집단 · 달마다 어디에 몰렸나</span>'
        f'<span class="lbl">{pop["name"]} · {axis_mod.CATEGORY} · 하한율 90 · 12개월 · {pop["n"]:,}회차</span>'
        '<span class="ghost" style="margin-left:auto;">닫기 ✕</span></div>'
        '<div class="lbl" style="padding:4px 0 12px;">진할수록 그 달에 그 값이 많았습니다. 오른쪽 끝은 그 달 표본입니다.</div>'
        f'{gen_cohort.heatmap(m, inner)}'
        '</div></div></x-dc></body></html>'
    )
    return HEAD.format(css=CSS) + body


def scorecard(width: int = 1440) -> str:
    """사업자번호 하나로 나오는 성적표. 입력 없이 원본 명단에서 찾는다. 낙찰을 단독 주인공으로 두지 않는다."""
    restyle_charts()

    def big(k: str, v: str, tail: str = "") -> str:
        t = f'<span class="lbl">{tail}</span>' if tail else ""
        # 꼬리는 숫자 옆이 아니라 아래 줄. 옆에 두면 폭이 좁아질 때 숫자가 꺾인다.
        return (
            '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:4px; padding:16px 20px;">'
            f'<span class="rl">{k}</span>'
            f'<span class="num" style="font-size:32px; font-weight:700; line-height:1.1; letter-spacing:-0.01em;'
            f' color:{INK}; white-space:nowrap;">{v}</span>{t}</div>'
        )

    def line(k: str, v: str, tail: str = "", sub: str = "") -> str:
        t = f' <span class="lbl">{tail}</span>' if tail else ""
        s = f'<span style="font-size:15px; font-weight:500; color:{INK2};">{sub}</span>' if sub else ""
        return (
            '<div style="display:grid; grid-template-columns:1fr auto; column-gap:16px; align-items:baseline;'
            f' padding:12px 0; border-top:1px solid {LINE};">'
            f'<span style="display:flex; flex-direction:column; gap:1px;"><span class="rl">{k}</span>{s}</span>'
            f'<span class="num" style="font-size:16px; color:{INK};">{v}{t}</span></div>'
        )

    recent = (
        ("08-27", "남산초등학교 · 축산", "내 값 90.309 · 낙찰 90.141", "0.168 높아 놓침"),
        ("08-21", "전주솔내유치원 · 농산", "내 값 90.120 · 낙찰 90.120", "낙찰"),
        ("08-13", "군산동고등학교 · 축산", "내 값 89.951 · 그날 하한 89.994", "그날 하한보다 낮아 무효"),
    )
    recent_rows = "".join(
        '<div style="display:grid; grid-template-columns:56px 1fr auto; column-gap:16px; align-items:baseline;'
        f' padding:12px 0; border-top:1px solid {LINE};">'
        f'<span class="lbl">{d}</span>'
        f'<span style="display:flex; flex-direction:column; gap:1px;"><span style="font-size:15px; font-weight:600; color:{INK};">{s}</span>'
        f'<span style="font-size:15px; font-weight:500; color:{INK2};">{v}</span></span>'
        f'<span class="num" style="font-size:16px; color:{BLUE if r == "낙찰" else RED if "무효" in r else INK};">{r}</span></div>'
        for d, s, v, r in recent
    )
    body = (
        f'<div style="position:relative; width:{width}px; min-height:1100px; background:{PAGE}; display:flex;">'
        f"{rail_nav(width)}"
        '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:16px; padding:12px; box-sizing:border-box; align-items:center;">'
        '<div style="width:760px; display:flex; flex-direction:column; gap:16px; padding-top:40px;">'
        '<span style="font-size:24px; font-weight:700;">내 성적표</span>'
        f'<div class="lbl">사업자번호만 넣으면 지난 1년 명단에서 내 투찰을 찾아 옵니다. 적어둔 값과 합치지 않습니다.</div>'
        '<div class="card" style="display:flex; align-items:center; gap:12px; padding:12px 16px;">'
        f'<span class="rl">사업자번호</span>'
        f'<span class="num" style="font-size:20px; color:{INK}; letter-spacing:0.02em;">402-81-*****</span>'
        '<span class="btn" style="margin-left:auto; height:44px;">불러오기</span></div>'
        '<div class="card" style="display:flex; padding:8px 0;">'
        f'{big("지난 1년 투찰", f"{MINE['bids']:,}회")}'
        f'{big("낙찰", f"{MINE['wins']}회", f"{MINE['win_pct']}%")}'
        f'{big("그날 하한보다 낮아 무효", "652회", f"{MINE['invalid_pct']}% · 전국 41.3%")}'
        "</div>"
        '<div class="card" style="padding:4px 16px 8px;">'
        f'{line("내가 보통 쓴 값", f"{MINE['median']:.3f}")}'
        f'{line("낙찰됐을 때 2등과 차이", "0.228%p", "보통", "전국은 0.061%p")}'
        f'{line("9곳 이하 명단에서 낙찰", "20.4%", "368회 중")}'
        f'{line("10~29곳 명단에서 낙찰", "9.2%", "1,231회 중")}'
        f'{line("30곳 이상 명단", "기록 없음")}'
        "</div>"
        '<div class="card" style="padding:12px 16px 8px;">'
        '<div style="display:flex; align-items:baseline; gap:8px;"><span style="font-size:20px; font-weight:700;">최근 복기</span>'
        '<span class="ghost" style="margin-left:auto;">전체 보기</span></div>'
        f"{recent_rows}</div>"
        '</div></div></div></x-dc></body></html>'
    )
    return HEAD.format(css=CSS) + body


def today(width: int = 1440) -> str:
    rows = []
    # (학교, 품목, 기초금액, 하한, 마감, 보통 참여, 최근 낙찰, 내 기록, 무효였을 회차/전체)
    sample = [("전주근영중학교", "축산", "2,761,700", "90", "D-1 11:00", 5, "90.141", "90.309 · 10:32", (0, 17)),
              ("정화노인요양원", "종합 3품목", "150,000,000", "84.245", "13시간", 0, "—", None, (0, 0)),
              ("공군항공안전단", "축산", "10,924,150", "88", "D-1", 5, "88.12", None, (2, 9)),
              ("부산 마리아마을", "종합 5품목", "43,879,200", "88", "D-1", 0, "—", None, (0, 0)),
              ("전주솔내유치원", "농산", "1,982,400", "90", "D-2", 7, "90.088", "90.120 · 어제", (6, 17)),
              ("익산남성중학교", "수산", "3,410,000", "90", "D-2", 12, "90.041", None, (0, 12)),
              ("군산동고등학교", "축산", "5,120,300", "90", "D-3", 9, "90.129", None, (3, 20)),
              ("완주삼례초등학교", "김치", "980,200", "90", "D-3", 4, "90.257", None, (0, 8))]
    for name, item, base, floor, due, usual, recent, record, (bad, total) in sample:
        # 무효였을 회차는 0이 아닌 줄에만 회색 숫자로. 배지를 줄마다 붙이면 목록이 장황해진다.
        bad_cell = f'<span class="lbl">{bad} / {total}</span>' if bad else ""
        rec_cell = (
            f'<span class="num" style="font-size:15px; color:{INK};">{record}</span>' if record
            else f'<span class="lbl" style="color:{FAINT};">없음</span>'
        )
        rows.append(
            '<tr>'
            f'<td class="b">{name}</td><td class="m">{item}</td><td class="r">{base}</td>'
            f'<td class="r m">{floor}</td><td class="r" style="color:{RED if due.startswith("D-1") else INK};">{due}</td>'
            f'<td class="r">{usual or "—"}</td><td class="r b">{recent}</td>'
            f'<td class="r">{bad_cell}</td><td class="r">{rec_cell}</td>'
            f'<td class="r"><span class="ghost" style="height:28px;">{"열기" if record else "투찰"}</span></td></tr>'
        )
    table = (
        '<table><thead><tr><th>학교</th><th>품목</th><th class="r">기초금액</th><th class="r">하한</th>'
        '<th class="r">마감</th><th class="r">보통 참여</th><th class="r">최근 낙찰</th>'
        '<th class="r">지금 값이면 무효였을</th><th class="r">내 기록</th><th></th></tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )
    body = (
        f'<div style="position:relative; width:{width}px; height:1100px; background:{PAGE}; display:flex; overflow:hidden;">'
        f"{rail_nav(width)}"
        '<div style="flex:1; min-width:0; display:flex; flex-direction:column; gap:16px; padding:12px; box-sizing:border-box;">'
        '<div style="display:flex; align-items:baseline; gap:12px;">'
        '<span style="font-size:24px; font-weight:700;">오늘</span>'
        '<span class="lbl">진행 중 공고 70건 · 내 자격 지역 67건</span>'
        '<span class="lbl" style="margin-left:auto;">10:30 기준</span></div>'
        f"{filters(width)}"
        '<div style="display:flex; gap:16px; align-items:flex-start;">'
        '<div class="card" style="flex:1; min-width:0; overflow:hidden;">'
        '<div style="display:flex; align-items:center; padding:12px 16px 4px;">'
        '<span style="font-size:15px; font-weight:700;">마감 임박</span>'
        '<span class="lbl" style="margin-left:8px;">8건</span>'
        '<span class="ghost" style="margin-left:auto;">⤢ 전체 70건</span></div>'
        f"{table}</div>"
        # 오늘 화면에 rail을 두지 않는다. 어느 학교의 투찰인지 없는 rail은 거짓이다.
        "</div>"
        "</div></div></x-dc></body></html>"
    )
    restyle_charts()
    return HEAD.format(css=CSS) + body


def main() -> int:
    global MULTI, FIRM_SELECTED, RECORDED
    pages = {
        "Merged1440.dc.html": detail(1440, "open"),
        "Merged1440Cohort.dc.html": detail(1440, "open", "흐름"),
        "Scorecard1440.dc.html": scorecard(1440),
    }
    FIRM_SELECTED = 1
    pages["Merged1440Firm.dc.html"] = detail(1440, "open", "업체")
    FIRM_SELECTED = None
    MULTI, RECORDED = True, "10:32"
    pages["Merged1440Multi.dc.html"] = detail(1440, "open")
    MULTI, RECORDED = False, None
    global LONG_YEARS
    LONG_YEARS = [(2026, 3, 17), (2025, 6, 41), (2024, 5, 39), (2023, 9, 44), (2022, 4, 38), (2021, 4, 35)]
    pages["Merged1440Long.dc.html"] = detail(1440, "open")
    LONG_YEARS = None
    pages["LargeCohort.dc.html"] = large_cohort(1440)
    pages.update({
        "Merged1440Closed.dc.html": detail(1440, "closed", "그날 하한"),
        "Merged1440None.dc.html": detail(1440, "none", "업체"),
        "Merged1280.dc.html": detail(1280, "open"),
        "Merged1024.dc.html": detail(1024, "open"),
        "Merged768.dc.html": detail(768, "open"),
        "Today1440.dc.html": today(1440),
    })
    for name, page in pages.items():
        with io.open(name, "w", encoding="utf-8", newline="") as handle:
            handle.write(page)
    print(f"합본 {len(pages)}장 생성")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
