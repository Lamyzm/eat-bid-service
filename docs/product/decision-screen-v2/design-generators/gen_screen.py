"""모듈 책임: 띠와 표를 한 장에 쌓아 실제 화면의 밀도로 결정 화면을 조립한다.

조각난 아트보드는 화면이 얼마나 빽빽한지 보여주지 못하므로 여기서만 전체를 합친다.
업체명은 실제 사업자를 쓰지 않고 지어낸 이름을 쓴다.
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
import gen_timeline as time_mod

INK = "oklch(0.22 0.012 150)"
MUTED = "oklch(0.42 0.014 150)"
SUNKEN = "oklch(0.965 0.005 142)"
SUBTLE = "oklch(0.94 0.006 145)"
PRIMARY = "oklch(0.43 0.085 158)"
RED = "oklch(0.55 0.2 27)"

FIRMS = [
    "가온유통", "나래식품", "다솜농산", "라온유통", "마루식자재", "바로유통",
    "사랑농산", "아람식품", "자연들유통", "차오름농산", "카람유통", "타래식품",
    "파란농산",
]
SELECTED = axis_mod.SELECTED
_CLIFF = axis_mod.ROUNDS[SELECTED][5]
_DEAD, _VALID = axis_mod.offsets(SELECTED)
ROUND_BIDS = [round(_CLIFF + offset, 3) for offset in _DEAD + _VALID]
INVALID = len(_DEAD)
ITEMS = ["축산", "농산", "수산", "김치", "공산"]
DAYS = [11, 2, 23, 13, 27, 18, 15, 5, 26, 19, 9, 30, 21, 11, 2, 23, 13, 27]


def money(value: float) -> str:
    return f"{round(value):,}"


def th(label: str, right: bool = False) -> str:
    align = "right" if right else "left"
    return (
        f'<th style="text-align: {align}; padding: 8px; font-size: 13px; font-weight: 600;'
        f' color: {MUTED}; white-space: nowrap;">{label}</th>'
    )


def td(value: str, right: bool = False, mono: bool = False, color: str = "",
       weight: int = 400) -> str:
    align = "right" if right else "left"
    family = (
        " font-family: 'Geist Mono', ui-monospace, monospace;" if mono else ""
    )
    tone = f" color: {color};" if color else ""
    return (
        f'<td style="text-align: {align}; padding: 8px; font-size: 15px;'
        f' font-weight: {weight};{family}{tone} white-space: nowrap;'
        f' border-top: 1px solid {SUBTLE};">{value}</td>'
    )


def seat_cell(percent: float, color: str) -> str:
    """자리는 0~100 유계라 셀 안에서 바로 눈금이 된다. 숫자만 두면 흔들림이 안 보인다."""
    return (
        '<td style="padding: 8px; border-top: 1px solid '
        + SUBTLE
        + ';"><div style="display: flex; align-items: center; gap: 8px;">'
        f'<div style="flex: 1; height: 4px; border-radius: 2px; background: {SUBTLE};">'
        f'<div style="width: {percent:.0f}%; height: 4px; border-radius: 2px;'
        f' background: {color};"></div></div>'
        '<span style="font-size: 15px; width: 22px; text-align: right;'
        " font-family: 'Geist Mono', ui-monospace, monospace;\">"
        f"{percent:.0f}</span></div></td>"
    )


def table(headers: list[tuple[str, bool]], rows: list[str]) -> str:
    head = "".join(th(label, right) for label, right in headers)
    return (
        '<table style="width: 100%; border-collapse: collapse;'
        ' font-variant-numeric: tabular-nums;">'
        f'<thead><tr style="background: {SUNKEN};">{head}</tr></thead>'
        f'<tbody>{"".join(rows)}</tbody></table>'
    )


def ladder() -> str:
    """이번 회차 명단 전체. 자리는 rank/(N-1)이다."""
    size = len(ROUND_BIDS)
    rows = []
    for index, rate in enumerate(ROUND_BIDS):
        seat = index / (size - 1) * 100
        if index < INVALID:
            state, color, weight = "무효", RED, 400
        elif index == INVALID:
            state, color, weight = "낙찰", PRIMARY, 600
        else:
            state, color, weight = "놓침", MUTED, 400
        rows.append(
            "<tr>"
            + td(FIRMS[index], weight=weight)
            + td(f"{seat:.0f}", right=True, mono=True, color=MUTED)
            + td(f"{rate:.3f}", right=True, mono=True, weight=weight)
            + td(state, right=True, color=color)
            + "</tr>"
        )
    return table([("업체", False), ("자리", True), ("사정률", True), ("", True)], rows)


def history() -> str:
    """과거 회차 전체. 기존 기록 렌즈의 열을 보존하고 자리 관련 열을 더한다."""
    rows = []
    for index, row in enumerate(time_mod.ROUNDS):
        month, size, invalid, win, second, max_invalid = row
        seat = time_mod.floor_seat(size, invalid)
        base = 2_100_000 + index * 47_300
        won = win >= time_mod.MY_RATE
        verdict = "낙찰됐을" if won else "놓침"
        color = PRIMARY if won else MUTED
        rows.append(
            "<tr>"
            + td(f"20{month}-{DAYS[index % len(DAYS)]:02d}", mono=True)
            + td(ITEMS[index % len(ITEMS)])
            + td(money(base), right=True, mono=True)
            + td("90", right=True, mono=True, color=MUTED)
            + td(f"{win:.3f}", right=True, mono=True, weight=600)
            + td(f"{second:.3f}", right=True, mono=True, color=MUTED)
            + td("—" if max_invalid is None else f"{max_invalid:.3f}",
                 right=True, mono=True, color=RED)
            + td(FIRMS[index % len(FIRMS)])
            + td(str(size), right=True, mono=True)
            + seat_cell(seat, RED)
            + td(f"{win - time_mod.MY_RATE:+.3f}", right=True, mono=True,
                 color=PRIMARY if won else MUTED)
            + td(verdict, right=True, color=color, weight=500 if won else 400)
            + "</tr>"
        )
    return table(
        [("개찰일", False), ("품목", False), ("기초금액", True), ("하한", True),
         ("낙찰률", True), ("2등가", True), ("그날 하한", True), ("낙찰 업체", False),
         ("명단", True), ("그날 하한 자리", False), ("낙찰 − 내 값", True), ("지금 값 썼다면", True)],
        rows,
    )


def firms() -> str:
    """이 학교에 반복 참여하는 업체. 기존 열을 두고 회차 내 위치 열을 더한다."""
    data = [
        (11, 3, "90.12 · 90.08 · 90.16", 90.76, 38),
        (11, 1, "90.31", 90.33, 44),
        (10, 2, "90.50 · 90.46", 89.97, 21),
        (10, 2, "90.34 · 90.14", 89.53, 18),
        (10, 0, "—", 91.16, 72),
        (9, 0, "—", 90.19, 51),
        (9, 2, "90.02 · 90.17", 91.16, 66),
        (9, 4, "90.12 · 90.18 · 90.28", 90.01, 12),
        (9, 1, "90.03", 90.76, 40),
        (8, 0, "—", 90.31, 55),
        (8, 1, "90.30", 91.67, 78),
        (8, 5, "90.38 · 90.83 · 90.86", 90.75, 24),
    ]
    rows = []
    for index, (part, wins, values, usual, seat) in enumerate(data):
        rows.append(
            "<tr>"
            + td(FIRMS[index % len(FIRMS)], weight=500 if wins >= 3 else 400)
            + td(str(part), right=True, mono=True)
            + td(str(wins), right=True, mono=True,
                 color=PRIMARY if wins else MUTED, weight=600 if wins else 400)
            + td(values, right=True, mono=True, color=MUTED)
            + td(f"{usual:.2f}", right=True, mono=True)
            + seat_cell(seat, PRIMARY if wins else MUTED)
            + "</tr>"
        )
    return table(
        [("업체", False), ("참여", True), ("낙찰", True), ("낙찰했던 값", True),
         ("보통 쓰는 자리", True), ("보통 서던 위치", False)],
        rows,
    )


# 문서(screen-system.md:72-75)가 정한 세 항목. 전역 분석 메뉴는 두지 않는다.
NAV = (("투찰 업무", True), ("복기", False), ("성과", False))


def sidebar() -> str:
    """제품의 뼈대. 셸이 없으면 화면이 스크린샷처럼 떠 보인다."""
    items = "".join(
        '<span style="display: block; padding: 12px 16px; border-radius: 4px;'
        f' font-size: 15px; font-weight: {600 if active else 400};'
        f' background: {SUNKEN if active else "transparent"};">{name}</span>'
        for name, active in NAV
    )
    return (
        '<div style="width: 200px; flex-shrink: 0; background: oklch(0.965 0.006 142);'
        f' border-right: 1px solid {SUBTLE}; padding: 24px 8px; display: flex;'
        ' flex-direction: column; gap: 4px;">'
        '<span style="font-size: 18px; font-weight: 600; padding: 0 16px 20px;">eatbid</span>'
        f"{items}"
        f'<span style="margin-top: auto; padding: 12px 16px; font-size: 13px; color: {MUTED};">'
        "게스트 · 사업자 미등록</span></div>"
    )


def filters() -> str:
    """화면의 모든 숫자가 어느 표본을 쓰는지 선언하는 첫 줄. 상자를 두르지 않는다."""
    axes = (
        ("지역", "전라북도 · 전주시"),
        ("품목", "축산"),
        ("기간", "최근 12개월"),
        ("기초금액대", "200만 ~ 300만원"),
    )
    chips = "".join(
        '<span style="display: inline-flex; align-items: center; gap: 8px; height: 40px;'
        f' padding: 0 16px; border-radius: 4px; background: {SUNKEN};">'
        f'<span style="font-size: 13px; color: {MUTED};">{name}</span>'
        f'<span style="font-size: 15px; font-weight: 600;">{value}</span>'
        f'<span style="font-size: 13px; color: {MUTED};">▾</span></span>'
        for name, value in axes
    )
    return (
        '<div style="display: flex; align-items: center; gap: 8px;">'
        f"{chips}"
        f'<span style="font-size: 13px; color: {MUTED}; margin-left: auto;">비교 대상</span>'
        '<span class="num" style="font-size: 18px; font-weight: 600;">1,847</span>'
        f'<span style="font-size: 13px; color: {MUTED};">건 · 제외</span>'
        '<span class="num" style="font-size: 15px;">257</span></div>'
    )


def bar() -> str:
    cells = (
        ("기초금액", money(2_761_700), "원", MUTED),
        ("투찰률", f"{time_mod.MY_RATE:.3f}", "", INK),
        ("넣을 금액", money(2_761_700 * time_mod.MY_RATE / 100), "원", INK),
        ("마진율", "—", "%", MUTED),
        ("마감", "D-1 · 09-04 11:00", "", RED),
    )
    blocks = "".join(
        '<div style="display: flex; flex-direction: column; gap: 2px;">'
        f'<span style="font-size: 13px; font-weight: 500; color: {MUTED};">{label}</span>'
        f'<span class="num" style="font-size: 18px; font-weight: 600; color: {tone};">{value}'
        f'<span style="font-size: 13px; color: {MUTED}; margin-left: 4px;">{unit}</span>'
        "</span></div>"
        for label, value, unit, tone in cells
    )
    return (
        '<div style="display: flex; align-items: center; gap: 32px; background: oklch(1 0 0);'
        f' border: 1px solid {SUBTLE}; border-radius: 8px; padding: 16px;">{blocks}'
        f'<span style="margin-left: auto; height: 32px; padding: 0 16px; border-radius: 4px;'
        f' background: {PRIMARY}; color: oklch(1 0 0); font-size: 15px; font-weight: 500;'
        ' display: inline-flex; align-items: center;">투찰 저장</span></div>'
    )


EXPAND = (
    '<span style="display: inline-flex; align-items: center; gap: 4px; height: 32px;'
    f' padding: 0 12px; border-radius: 4px; background: {SUNKEN}; font-size: 13px;'
    f' font-weight: 500; color: {INK}; margin-left: 8px;">⤢ 크게 보기</span>'
)


def card(title: str, extra: str, body: str, flush: bool = False, note: str = "",
         expand: bool = False) -> str:
    """테두리를 두르지 않는다. 흰 면과 페이지 바탕의 톤 차이로만 나눈다.

    차트 카드는 항상 크게 보기를 단다. 전제 조건이다.
    """
    padding = "20px 0 0" if flush else "20px"
    pad = " padding: 0 20px;" if flush else ""
    caption = (
        f'<div style="font-size: 13px; color: {MUTED}; line-height: 19px;{pad}">{note}</div>'
        if note else ""
    )
    return (
        '<div style="background: oklch(1 0 0); border-radius: 8px;'
        f' padding: {padding}; display: flex; flex-direction: column;'
        ' gap: 12px; overflow: hidden;">'
        f'<div style="display: flex; align-items: center; gap: 8px;{pad}">'
        f'<span style="font-size: 18px; font-weight: 600;">{title}</span>'
        f'<span class="info">i</span>{extra}{EXPAND if expand else ""}</div>{caption}{body}</div>'
    )


def decision_panel() -> str:
    """PC 폭을 살려 차트 옆에 상주시킨다. 스크롤 없이 값을 넣고 저장한다."""
    rows = (
        ("기초금액", money(2_761_700), "원", MUTED, 18),
        ("넣을 금액", money(2_761_700 * time_mod.MY_RATE / 100), "원", INK, 24),
    )
    facts = "".join(
        '<div style="display: flex; align-items: baseline; justify-content: space-between;">'
        f'<span style="font-size: 13px; color: {MUTED};">{label}</span>'
        f'<span class="num" style="font-size: {size}px; font-weight: 600; color: {tone};">'
        f'{value}<span style="font-size: 13px; color: {MUTED}; margin-left: 4px;">{unit}'
        "</span></span></div>"
        for label, value, unit, tone, size in rows
    )
    tiles = (
        ("2등과의 격차", "0.061", "%p", "상세 26,000건 중앙"),
        ("최저가로 이긴 비율", "42 → 2", "%", "명단 3~9곳 → 10곳 이상"),
        ("전체 투찰 중앙", "89.429", "", "명시 하한 90 아래"),
        ("우리 계산 그날 하한", "40 / 68", "", "원본 판정과 일치한 회차"),
    )
    stats = "".join(
        f'<div style="display: flex; flex-direction: column; gap: 2px; padding: 12px 0;'
        f' border-top: 1px solid {SUBTLE};">'
        f'<span style="font-size: 13px; color: {MUTED};">{label} <span class="info">i</span></span>'
        f'<span class="num" style="font-size: 24px; font-weight: 600;">{value}'
        f'<span style="font-size: 13px; color: {MUTED}; margin-left: 2px;">{unit}</span></span>'
        f'<span style="font-size: 13px; color: {MUTED};">{note}</span></div>'
        for label, value, unit, note in tiles
    )
    return (
        '<div style="background: oklch(1 0 0); border-radius: 8px; padding: 20px;'
        ' display: flex; flex-direction: column; gap: 12px;">'
        '<div style="display: flex; align-items: baseline; gap: 8px;">'
        '<span style="font-size: 18px; font-weight: 600;">투찰</span>'
        f'<span class="num" style="font-size: 13px; color: {RED}; margin-left: auto;">'
        "D-1 · 09-04 11:00</span></div>"
        f"{facts}"
        f'<div style="display: flex; align-items: center; gap: 8px; height: 48px;'
        f' padding: 0 16px; border-radius: 4px; background: {SUNKEN};">'
        f'<span style="font-size: 13px; color: {MUTED};">투찰률</span>'
        '<span class="num" style="font-size: 24px; font-weight: 600; margin-left: auto;">'
        f'{time_mod.MY_RATE:.3f}</span></div>'
        f'<div style="height: 48px; border-radius: 4px; background: {PRIMARY};'
        ' color: oklch(1 0 0); font-size: 15px; font-weight: 600; display: flex;'
        ' align-items: center; justify-content: center;">투찰 저장</div>'
        f"{stats}</div>"
    )


def roster_pending() -> str:
    """개찰 전에는 명단이 없다. API가 빈 배열과 null meta를 준다."""
    facts = (
        ("보통 참여", "5", "곳"),
        ("같은 하한 회차", "12", "회"),
        ("최근 낙찰", "90.141", ""),
        ("그 전", "90.129", ""),
        ("그 전", "90.067", ""),
    )
    rows = "".join(
        '<div style="display: flex; align-items: baseline; justify-content: space-between;'
        f' padding: 12px 0; border-top: 1px solid {SUBTLE};">'
        f'<span style="font-size: 15px; color: {MUTED};">{label}</span>'
        f'<span class="num" style="font-size: 18px; font-weight: 600;">{value}'
        f'<span style="font-size: 13px; color: {MUTED}; margin-left: 4px;">{unit}</span>'
        "</span></div>"
        for label, value, unit in facts
    )
    return (
        f'<div style="background: {SUNKEN}; border-radius: 4px; padding: 16px;'
        f' font-size: 15px; color: {MUTED}; line-height: 21px;">'
        "누가 얼마를 넣었는지는 개찰이 끝나야 공개됩니다. 지금 볼 수 있는 것은 이 학교의 지난 기록뿐입니다."
        f"</div>{rows}"
    )


HTML = """<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <script src="./support.js"></script>
</head>
<body>
<x-dc>
<helmet>
  <style>
    body {{ margin: 0; font-family: 'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; -webkit-font-smoothing: antialiased; }}
    .num {{ font-family: 'Geist Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }}
    .info {{ display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 999px; border: 1px solid {muted}; color: {muted}; font-size: 12px; line-height: 1; }}
    .key {{ display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: {muted}; }}
    .tile {{ background: {sunken}; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 4px; flex: 1; }}
  </style>
</helmet>

<div style="width: 1440px; background: oklch(0.982 0.004 140); color: {ink}; display: flex;">
{sidebar}
  <div style="flex-grow: 1; min-width: 0; padding: 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 16px;">

  <div style="display: flex; align-items: baseline; gap: 8px;">
    <span style="font-size: 24px; font-weight: 600; letter-spacing: -0.01em; line-height: 30px;">전주근영중학교</span>
    <span style="font-size: 15px; color: {muted};">축산</span>
    <span class="num" style="font-size: 13px; color: {muted}; margin-left: auto;">{rounds}회 · 2025-09 ~ 2026-08 · 하한율 90</span>
  </div>

{filters}

  <div style="display: flex; gap: 16px; align-items: flex-start;">
    <div style="flex-grow: 1; min-width: 0; display: flex; flex-direction: column; gap: 16px;">
{timeline_card}
{history_card}
{axis_card}
{firms_card}
    </div>
    <div style="width: 340px; flex-shrink: 0; position: sticky; top: 24px; display: flex; flex-direction: column; gap: 16px;">
{decision}
{roster_card}
    </div>
  </div>

  </div>
</div>
</x-dc>
</body>
</html>
"""


def main() -> int:
    legend = (
        '<span class="key" style="margin-left: auto;">'
        f'<span style="width: 12px; height: 2px; background: {INK};"></span>낙찰</span>'
        '<span class="key">'
        f'<span style="width: 12px; height: 2px; background: {INK}; opacity: 0.4;"></span>2등</span>'
        '<span class="key">'
        f'<span style="width: 12px; height: 2px; background: {RED};"></span>그날 하한</span>'
        '<span class="key">'
        f'<span style="width: 12px; height: 2px; background: {PRIMARY};"></span>내 값</span>'
    )
    meta = (
        '<span class="num" style="font-size: 13px; color: '
        + MUTED
        + '; margin-left: auto;">'
    )
    page = HTML.format(
        ink=INK, muted=MUTED, sunken=SUNKEN, subtle=SUBTLE,
        rounds=len(axis_mod.ROUNDS),
        sidebar=sidebar(),
        filters=filters(),
        decision=decision_panel(),
        timeline_card=card(
            "회차별 흐름", legend, time_mod.chart(), expand=True,
            note="세로는 사정률입니다. 붉은 선 아래로 넣으면 무효가 되고, 그 선은 개찰 때 뽑히는"
                 " 예정가격이 정하므로 회차마다 움직입니다."),
        history_card=card(
            "과거 회차", meta + f"{len(axis_mod.ROUNDS)}회</span>", history(), flush=True,
            note="줄을 누르면 그 회차의 명단과 추첨 결과를 봅니다."),
        axis_card=card(
            "그날 하한 위 자리", '<span style="margin-left: auto;"></span>',
            axis_mod.chart(), expand=True,
            note="가로 0은 그 회차에서 떨어진 가장 높은 값입니다. 이기는 값은 늘 그 바로 위에"
                 " 있고, 회차가 달라도 같은 %p가 같은 거리로 그려집니다. "
                 f'<span class="num">{axis_mod.resolution_note()}</span>'),
        roster_card=card(
            "이번 회차 명단", meta + "개찰 전</span>", roster_pending()),
        firms_card=card(
            "참여 업체", meta + "12곳 · 2회 이상</span>", firms(), flush=True,
            note="보통 서던 위치는 그 업체 투찰이 회차 안에서 아래에서 몇 번째였는지의 중앙값입니다."),
    )
    with io.open("Screen.dc.html", "w", encoding="utf-8", newline="") as handle:
        handle.write(page)
    print("Screen.dc.html 생성 · 표 3개 · 그림 2개")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
