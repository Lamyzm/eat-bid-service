"""모듈 책임: 학교 회차별 흐름을 세 패널로 나눠 하나의 시간축 위에 그린다.

한 그림의 잉크 예산을 지키려고 사정률·명단·자리를 각각 독립 패널로 쪼갠다.
절대 사정률 축은 이상치가 폭을 먹으므로 하한 위 1.5%p 창에 고정하고 벗어난 값은 가장자리로 뺀다.
"""

from __future__ import annotations

import io

INK = "oklch(0.22 0.012 150)"
MUTED = "oklch(0.42 0.014 150)"
SECOND = "oklch(0.36 0.013 150)"
SUNKEN = "oklch(0.965 0.005 142)"
SUBTLE = "oklch(0.94 0.006 145)"
STRONG = "oklch(0.84 0.01 145)"
PRIMARY = "oklch(0.43 0.085 158)"
RED = "oklch(0.55 0.2 27)"
MONO = "'Geist Mono', ui-monospace, monospace"

import sys

sys.path.insert(
    0,
    r"C:\Users\kano\AppData\Local\Temp\claude\F--Project-eat-bid-service"
    r"\969c0791-3647-4b2d-bec4-3b3a916a7f12\scratchpad",
)

import gen_axis as axis_mod

MY_RATE = axis_mod.MY_RATE
# 낙찰이 몰리는 폭에 맞춰 좁힌다. 89.5~91.0으로 두면 0.061%p가 7px밖에 안 된다.
RATE_LOW, RATE_HIGH = 89.9, 90.7

# 회차 자료는 gen_axis 하나만 소유한다. 두 벌로 두면 회차 수가 어긋난다.
ROUNDS = axis_mod.ROUNDS
# 기본은 낙찰과 내 값 둘만. 나머지 계열은 범례를 눌러 켠다. 처음 보는 눈에 선 넷은 많다.
SHOW_SECOND, SHOW_CLIFF, SHOW_OTHER = False, False, False

# 좌측 열 카드 안쪽 폭 784에 맞춘다. 축소 렌더를 피한다.
# 크게 보기는 VIEW_W와 PLOT_W를 바꿔 같은 함수로 그린다.
VIEW_W = 784.0
PLOT_X0, PLOT_W, LABEL_X = 100.0, 672.0, 88.0
RATE_TOP, RATE_BOTTOM = 32.0, 300.0
SIZE_TOP, SIZE_BOTTOM = 332.0, 388.0
SEAT_TOP, SEAT_BOTTOM = 412.0, 480.0
AXIS_Y = 480.0
PPU = (RATE_BOTTOM - RATE_TOP) / (RATE_HIGH - RATE_LOW)   # px per %p


def tx(index: int) -> float:
    return round(PLOT_X0 + index / (len(ROUNDS) - 1) * PLOT_W, 2)


def ry(value: float) -> float:
    span = RATE_BOTTOM - RATE_TOP
    ratio = (value - RATE_LOW) / (RATE_HIGH - RATE_LOW)
    return round(RATE_BOTTOM - min(max(ratio, 0.0), 1.0) * span, 2)


def sy(percent: float) -> float:
    return round(SEAT_BOTTOM - percent / 100 * (SEAT_BOTTOM - SEAT_TOP), 2)


def floor_seat(size: int, invalid: int) -> float:
    return 0.0 if invalid == 0 else (invalid - 1) / (size - 1) * 100


def polyline(points: list[tuple[float, float]], color: str, width: float,
             opacity: float = 1.0) -> str:
    path = " ".join(f"{x},{y}" for x, y in points)
    return (
        f'    <polyline points="{path}" fill="none" stroke="{color}"'
        f' stroke-width="{width}" stroke-linejoin="round" opacity="{opacity}" />'
    )


def rate_panel() -> str:
    out = []
    for value in (89.9, 90.1, 90.3, 90.5, 90.7):
        y = ry(value)
        out.append(
            f'    <line x1="{PLOT_X0}" y1="{y}" x2="{tx(len(ROUNDS) - 1)}" y2="{y}"'
            f' stroke="{SUBTLE}" stroke-width="1" />'
            f'\n    <text x="{LABEL_X}" y="{y + 4}" text-anchor="end" font-size="13" font-weight="600"'
            f' fill="{SECOND}" font-family="{MONO}">{value:.1f}</text>'
        )

    # 선은 지금 품목의 회차만 잇는다. 다른 품목은 경쟁 구조가 달라 추세처럼 보이면 거짓이다.
    sel = set(axis_mod.selected_rounds())
    if SHOW_SECOND:
        out.append(polyline(
            [(tx(i), ry(row[4])) for i, row in enumerate(ROUNDS) if i in sel], INK, 1.5, 0.4))
    # 그날 하한은 규칙 사실이라 남기되 내 값보다 튀지 않게 얇고 옅게 둔다.
    if SHOW_CLIFF:
        out.append(polyline(
            [(tx(i), ry(row[5])) for i, row in enumerate(ROUNDS) if row[5] is not None and i in sel],
            RED, 1.25, 0.8))
    out.append(polyline(
        [(tx(i), ry(row[3])) for i, row in enumerate(ROUNDS) if i in sel], INK, 2))

    for index, row in enumerate(ROUNDS):
        if index in sel:
            out.append(f'    <circle cx="{tx(index)}" cy="{ry(row[3])}" r="4.5" fill="{INK}" />')
        elif SHOW_OTHER:
            out.append(
                f'    <circle cx="{tx(index)}" cy="{ry(row[3])}" r="4.5" fill="{SUNKEN}"'
                f' stroke="{INK}" stroke-width="1.5" />'
            )
        else:
            continue
        over = [value for value in ((row[3], row[4]) if SHOW_SECOND else (row[3],)) if value > RATE_HIGH]
        if over:
            out.append(
                f'    <path d="M {tx(index)} {RATE_TOP - 7} l 5 7 l -10 0 z" fill="{INK}"'
                f' opacity="0.4" />'
                f'\n    <text x="{tx(index)}" y="{RATE_TOP - 12}" text-anchor="middle"'
                f' font-size="13" font-weight="600" fill="{SECOND}" font-family="{MONO}">{max(over):.2f}</text>'
            )

    y = ry(MY_RATE)
    out.append(
        f'    <line x1="{PLOT_X0}" y1="{y}" x2="{tx(len(ROUNDS) - 1)}" y2="{y}"'
        f' stroke="{PRIMARY}" stroke-width="3" />'
        f'\n    <rect x="{tx(len(ROUNDS) - 1) - 84}" y="{y - 24}" width="84" height="22"'
        f' rx="6" fill="{PRIMARY}" />'
        f'\n    <text x="{tx(len(ROUNDS) - 1) - 42}" y="{y - 8}" text-anchor="middle"'
        f' font-size="13" font-weight="700" fill="oklch(1 0 0)">내 값 {MY_RATE:.3f}</text>'
    )
    return "\n".join(out)


def size_cap() -> int:
    """명단 상한은 그 학교의 3사분위에 맞춘다. 고정 40은 실제 학교(45~94곳)에서 전부 넘친다."""
    sizes = sorted(row[1] for row in ROUNDS)
    q3 = sizes[int(len(sizes) * 0.75)]
    return max(10, (q3 + 9) // 10 * 10)


SIZE_CAP = 40   # 호출 시점에 size_cap()으로 갱신한다.


def size_panel() -> str:
    global SIZE_CAP
    SIZE_CAP = size_cap()
    width = round(PLOT_W / len(ROUNDS) * 0.5, 2)
    out = []
    for index, row in enumerate(ROUNDS):
        clipped = min(row[1], SIZE_CAP)
        height = round(clipped / SIZE_CAP * (SIZE_BOTTOM - SIZE_TOP), 2)
        out.append(
            f'    <rect x="{round(tx(index) - width / 2, 2)}"'
            f' y="{round(SIZE_BOTTOM - height, 2)}" width="{width}" height="{height}"'
            f' fill="{STRONG}" />'
        )
        # 상한을 넘는 막대의 숫자는 그리지 않는다. 시선을 먹는다. 정확한 수는 표에 있다.
    out.append(
        f'    <text x="{LABEL_X}" y="{SIZE_TOP + 4}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{SECOND}" font-family="{MONO}">{SIZE_CAP}+</text>'
        f'\n    <text x="{LABEL_X}" y="{SIZE_BOTTOM}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{SECOND}" font-family="{MONO}">0</text>'
    )
    return "\n".join(out)


def seat_panel() -> str:
    """그날 하한의 자리만 그린다. 내 값의 자리는 회차별 명단이 있어야 계산되므로 넣지 않는다."""
    area = [(tx(i), sy(floor_seat(row[1], row[2]))) for i, row in enumerate(ROUNDS)]
    path = " ".join(f"{x},{y}" for x, y in area)
    out = [
        f'    <polygon points="{PLOT_X0},{SEAT_BOTTOM} {path}'
        f' {tx(len(ROUNDS) - 1)},{SEAT_BOTTOM}" fill="{RED}" opacity="0.12" />',
        polyline(area, RED, 1.5),
    ]
    for value in (0, 50, 100):
        out.append(
            f'    <text x="{LABEL_X}" y="{sy(value) + 4}" text-anchor="end" font-size="13" font-weight="600"'
            f' fill="{SECOND}" font-family="{MONO}">{value}</text>'
        )
    return "\n".join(out)


def axis() -> str:
    out = [
        f'    <line x1="{PLOT_X0}" y1="{AXIS_Y}" x2="{tx(len(ROUNDS) - 1)}" y2="{AXIS_Y}"'
        f' stroke="{SUBTLE}" stroke-width="1" />'
    ]
    previous, last_x = "", -999.0
    for index, row in enumerate(ROUNDS):
        # 같은 달이 둘이거나 라벨이 44px 안에 붙으면 건너뛴다. 겹친 글자는 읽히지 않는다.
        if row[0] == previous or tx(index) - last_x < 56:
            continue
        previous, last_x = row[0], tx(index)
        out.append(
            f'    <text x="{tx(index)}" y="{AXIS_Y + 16}" text-anchor="middle"'
            f' font-size="13" font-weight="600" fill="{SECOND}" font-family="{MONO}">{row[0]}</text>'
        )
    return "\n".join(out)


def lane_names() -> str:
    rows = (
        (RATE_TOP + 8, "사정률"),
        (SIZE_TOP + 26, "명단"),
        (SEAT_TOP + 22, "자리"),
    )
    return "\n".join(
        f'    <text x="{LABEL_X - 34}" y="{y}" text-anchor="end" font-size="13" font-weight="600"'
        f' font-weight="500" fill="{MUTED}">{name}</text>'
        for y, name in rows
    )


def chart() -> str:
    """흐름 탭. 자리 패널은 그날 하한 탭으로 옮겼다. 사장은 '자리'를 묻지 않는다."""
    global AXIS_Y
    AXIS_Y = SIZE_BOTTOM + 12
    names = "\n".join(
        f'    <text x="{LABEL_X - 34}" y="{y}" text-anchor="end" font-size="13" font-weight="600"'
        f' font-weight="600" fill="{MUTED}">{name}</text>'
        for y, name in ((RATE_TOP + 8, "사정률"), (SIZE_TOP + 26, "명단"))
    )
    height = int(AXIS_Y + 32)
    return f"""      <svg viewBox="0 0 {VIEW_W:.0f} {height}" width="{VIEW_W:.0f}" height="{height}" role="img"
        aria-label="회차별 낙찰률과 명단 크기" style="display: block;">
{rate_panel()}
{size_panel()}
{axis()}
{names}
      </svg>"""


def seat_chart() -> str:
    """그날 하한 탭 아래 붙는 회차별 그날 하한 자리. 축 좌표는 그대로 두고 위로 당겨 그린다."""
    global AXIS_Y
    AXIS_Y = SEAT_BOTTOM
    shift = SEAT_TOP - 16
    height = int(SEAT_BOTTOM - shift + 32)
    name = (
        f'    <text x="{LABEL_X - 34}" y="{SEAT_TOP + 22}" text-anchor="end" font-size="13" font-weight="600"'
        f' font-weight="600" fill="{MUTED}">자리</text>'
    )
    return f"""      <svg viewBox="0 0 {VIEW_W:.0f} {height}" width="{VIEW_W:.0f}" height="{height}" role="img"
        aria-label="회차별 그날 하한 자리" style="display: block;">
      <g transform="translate(0,-{shift:.0f})">
{seat_panel()}
{axis()}
{name}
      </g>
      </svg>"""


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
    .info {{ display: inline-flex; align-items: center; justify-content: center; width: 14px; height: 14px; border-radius: 999px; border: 1px solid {muted}; color: {muted}; font-size: 12px; line-height: 1; vertical-align: 1px; }}
    .key {{ display: inline-flex; align-items: center; gap: 4px; font-size: 13px; color: {muted}; }}
    .tile {{ background: {sunken}; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 4px; flex: 1; }}
  </style>
</helmet>

<div style="width: 1440px; background: oklch(0.982 0.004 140); color: {ink}; padding: 48px 24px; box-sizing: border-box; display: flex; flex-direction: column; gap: 32px;">

  <div style="display: flex; align-items: baseline; gap: 8px;">
    <span style="font-size: 24px; font-weight: 600; letter-spacing: -0.01em; line-height: 26px;">전주근영중학교</span>
    <span style="font-size: 15px; color: {muted};">축산</span>
    <span class="num" style="font-size: 13px; color: {muted}; margin-left: auto;">18회 · 2025-09 ~ 2026-08 · 하한율 90</span>
  </div>

  <div style="background: oklch(1 0 0); border: 1px solid {subtle}; border-radius: 8px; padding: 16px; display: flex; flex-direction: column; gap: 16px;">
    <div style="display: flex; align-items: baseline; gap: 16px;">
      <span style="font-size: 18px; font-weight: 600;">회차별 흐름</span>
      <span class="info">i</span>
      <span class="key" style="margin-left: auto;"><span style="width: 12px; height: 2px; background: {ink};"></span>낙찰</span>
      <span class="key"><span style="width: 12px; height: 2px; background: {ink}; opacity: 0.4;"></span>2등</span>
      <span class="key"><span style="width: 12px; height: 2px; background: {red};"></span>그날 하한</span>
      <span class="key"><span style="width: 12px; height: 2px; background: {primary};"></span>내 값</span>
    </div>
{chart}
  </div>

  <div style="display: flex; gap: 16px;">
    <div class="tile">
      <span style="font-size: 13px; font-weight: 500; color: {muted};">이 값이면 유효 <span class="info">i</span></span>
      <span class="num" style="font-size: 32px; font-weight: 500; line-height: 30px;">18 <span style="color: {muted};">/ 18</span></span>
      <span style="font-size: 13px; color: {muted};">그날 하한보다 항상 위</span>
    </div>
    <div class="tile">
      <span style="font-size: 13px; font-weight: 500; color: {muted};">2등과의 격차 중앙 <span class="info">i</span></span>
      <span class="num" style="font-size: 32px; font-weight: 500; line-height: 30px;">0.061<span style="font-size: 18px; color: {muted};">%p</span></span>
      <span style="font-size: 13px; color: {muted};">상세 26,000건 전국</span>
    </div>
    <div class="tile">
      <span style="font-size: 13px; font-weight: 500; color: {muted};">그날 하한 폭 <span class="info">i</span></span>
      <span class="num" style="font-size: 32px; font-weight: 500; line-height: 30px;">0 <span style="color: {muted};">~</span> 77</span>
      <span style="font-size: 13px; color: {muted};">회차마다 추첨이 정함</span>
    </div>
  </div>

</div>
</x-dc>
</body>
</html>
"""


def main() -> int:
    page = HTML.format(
        ink=INK, muted=MUTED, subtle=SUBTLE, sunken=SUNKEN, strong=STRONG,
        red=RED, primary=PRIMARY, chart=chart(),
    )
    with io.open("Timeline.dc.html", "w", encoding="utf-8", newline="") as handle:
        handle.write(page)
    seats = [floor_seat(r[1], r[2]) for r in ROUNDS]
    print(
        f"Timeline.dc.html 생성 · 회차 {len(ROUNDS)} ·"
        f" 그날 하한 자리 {min(seats):.0f}~{max(seats):.0f}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
