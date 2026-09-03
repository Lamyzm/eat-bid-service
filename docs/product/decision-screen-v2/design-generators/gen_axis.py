"""모듈 책임: 관측된 그날 하한을 원점으로 삼는 선형 %p 축 위에 투찰을 그린다.

순위 백분위 축은 거리를 보존하지 않아 0.200%p와 0.013%p를 같은 픽셀로 그렸다.
이 축은 해상도를 고정해 회차가 달라도 같은 %p가 같은 픽셀이 되게 한다.
viewBox 폭을 렌더 폭과 같게 두어 축소로 글자가 뭉개지지 않게 한다.
"""

from __future__ import annotations

import io

INK = "oklch(0.22 0.012 150)"
MUTED = "oklch(0.42 0.014 150)"
STRONG = "oklch(0.84 0.01 145)"
PRIMARY = "oklch(0.43 0.085 158)"
RED = "oklch(0.55 0.2 27)"
SUBTLE = "oklch(0.94 0.006 145)"
MONO = "'Geist Mono', ui-monospace, monospace"

# 투명도는 세 단계만 쓴다.
FULL, HALF, FAINT = 1.0, 0.5, 0.24

# 좌측 열 카드 안쪽 폭과 같다. 1440 − 사이드바 232 − 여백 48 − 우측 열 336 − 카드 여백 40
VIEW_W = 784.0
GUTTER = 96.0             # 무효 칸. 축척이 없다는 뜻으로 눈금을 두지 않는다.
MAIN_X0, MAIN_X1 = 150.0, 700.0
TAIL_X1 = 776.0
MAIN_MAX = 1.5            # 투찰 밀도 관측 창과 같은 폭
LABEL_X = 88.0

# 레인은 셋. 이 회차 명단, 지난 낙찰이 선 자리, 전국 분포.
# 회차별 줄 20개는 걷어냈다. 줄마다 모양이 같아 융단이 될 뿐이고,
# 명단 크기·무효 경계·낙찰 위치 셋은 아래 표가 이미 담는다.
LANE1_Y = 56.0            # 이 회차 명단
LANE2_Y = 108.0           # 지난 낙찰이 선 자리
LANE3_Y = 152.0           # 전국 분포
AXIS_Y = 212.0

MY_RATE = 90.309

# (개찰 월, 명단, 무효, 낙찰률, 2등가, 관측된 그날 하한)
ROUNDS = [
    ("25-09", 13, 3, 90.141, 90.341, 89.865),
    ("25-10", 16, 1, 90.097, 90.160, 89.962),
    ("25-10", 15, 5, 90.061, 90.187, 89.593),
    ("25-11", 17, 9, 90.120, 90.214, 89.957),
    ("25-11", 9, 0, 90.894, 92.306, None),
    ("25-12", 15, 10, 90.071, 90.141, 89.995),
    ("26-01", 19, 13, 90.271, 90.370, 89.832),
    ("26-02", 18, 14, 90.251, 91.668, 89.867),
    ("26-02", 31, 1, 90.257, 90.260, 89.956),
    ("26-03", 22, 6, 90.088, 90.129, 89.901),
    ("26-04", 12, 2, 90.310, 90.565, 89.780),
    ("26-04", 27, 11, 90.045, 90.063, 89.988),
    ("26-05", 14, 4, 90.183, 90.315, 89.842),
    ("26-06", 30, 17, 90.036, 90.048, 89.994),
    ("26-07", 11, 1, 90.402, 90.720, 89.712),
    ("26-07", 24, 9, 90.067, 90.096, 89.933),
    ("26-08", 20, 5, 90.129, 90.206, 89.876),
    ("26-08", 87, 41, 90.041, 90.048, 89.996),
    ("26-08", 197, 96, 90.018, 90.021, 89.999),
    ("26-08", 13, 3, 90.141, 90.341, 89.865),
]
# 회차별 품목. 품목마다 경쟁 구조가 달라 한 선으로 잇지 않는다. 실데이터 생성기가 덮어쓴다.
CATEGORIES = ["축산"] * 20
CATEGORIES[4], CATEGORIES[17], CATEGORIES[18] = "수산", "공산", "공산"
CATEGORY = "축산"           # 지금 열린 공고의 품목. 선과 예행은 이 품목 회차만 쓴다.


def selected_rounds() -> list[int]:
    return [i for i, c in enumerate(CATEGORIES) if c == CATEGORY]


SELECTED = 19               # 축 아래 절대 사정률을 매길 회차
DENSE_ROSTER = 60           # 이보다 크면 점이 겹쳐 눈금으로 바꾼다
BASE_AMOUNT = 2_761_700


def mx(offset: float) -> float:
    """하한 위 %p를 x로 옮긴다. 주 구간은 선형, 넘으면 압축 칸 한 곳에 모은다."""
    if offset > MAIN_MAX:
        return round((MAIN_X1 + TAIL_X1) / 2, 2)
    return round(MAIN_X0 + offset / MAIN_MAX * (MAIN_X1 - MAIN_X0), 2)


PPU = (MAIN_X1 - MAIN_X0) / MAIN_MAX     # px per %p


def offsets(index: int) -> tuple[list[float], list[float]]:
    """그 회차의 무효 투찰과 유효 투찰을 하한 위 %p로 만든다.

    실측 명단이 있는 회차는 그 값을, 나머지는 명단 크기와 무효 수와 낙찰·2등으로 채운다.
    """
    _month, size, invalid, win, second, cliff = ROUNDS[index]
    if cliff is None:
        cliff = win - 0.30
    valid_count = size - invalid
    first, gap = win - cliff, second - win
    valid = [first, first + gap]
    # 실측 회차의 인접 간격을 그대로 순환시킨다. 복리로 키우면 사정률이 폭주한다.
    steps = (0.096, 0.013, 0.255, 0.171, 0.121, 0.114, 0.068, 0.203, 0.089, 0.147)
    # 명단이 클수록 같은 폭에 더 많이 들어차므로 간격을 표본 수로 나눈다.
    scale = min(1.0, 12 / max(valid_count, 1))
    for rank in range(2, valid_count):
        valid.append(valid[-1] + steps[(index + rank) % len(steps)] * scale)
    if valid_count >= 4:
        valid[-1] += 1.9                      # 회차마다 하나씩 나오는 높은 값
    return [-0.04 * (invalid - k) for k in range(invalid)], valid[:valid_count]


def cliff_line() -> str:
    return (
        f'    <line x1="{MAIN_X0}" y1="{LANE1_Y - 34}" x2="{MAIN_X0}" y2="{AXIS_Y}"'
        f' stroke="{RED}" stroke-width="1.5" />\n'
        f'    <text x="{MAIN_X0 - 8}" y="{LANE1_Y - 38}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{RED}">그날 하한</text>'
    )


def lane_this_round() -> str:
    """선택 회차의 명단 전체. 무효는 축 밖 왼쪽에 두고 낙찰만 채운 점으로 남긴다."""
    dead, valid = offsets(SELECTED)
    out = []
    for slot in range(len(dead)):
        out.append(
            f'    <circle cx="{round(MAIN_X0 - 18 - slot * 14, 1)}" cy="{LANE1_Y}" r="5"'
            f' fill="none" stroke="{RED}" stroke-width="1.5" />'
        )
    for rank, offset in enumerate(valid):
        x = mx(offset)
        if rank == 0:
            out.append(
                f'    <circle cx="{x}" cy="{LANE1_Y}" r="7" fill="{INK}" />'
                f'\n    <text x="{x}" y="{LANE1_Y - 16}" text-anchor="middle" font-size="13" font-weight="600"'
                f' fill="{INK}">낙찰</text>'
            )
        else:
            out.append(
                f'    <circle cx="{x}" cy="{LANE1_Y}" r="5" fill="none" stroke="{INK}"'
                f' stroke-width="1.5" opacity="{HALF}" />'
            )
    return "\n".join(out)


def lane_wins() -> str:
    """지난 회차의 낙찰이 그날 하한에서 얼마나 위였는지. 겹치면 위로 쌓는다."""
    stacks: dict[int, int] = {}
    out = []
    for _month, _size, _invalid, win, _second, cliff in ROUNDS:
        if cliff is None:
            continue
        offset = win - cliff
        slot = int(offset / 0.05)
        level = stacks.get(slot, 0)
        stacks[slot] = level + 1
        out.append(
            f'    <circle cx="{mx(offset)}" cy="{LANE2_Y - level * 12}" r="5"'
            f' fill="{INK}" />'
        )
    return "\n".join(out)


NATIONAL = [
    62, 78, 91, 104, 112, 118, 121, 119, 114, 108, 101, 94, 87, 80, 74, 68,
    62, 57, 52, 48, 44, 40, 37, 34, 31, 29, 26, 24, 22, 20, 19, 17, 16, 15,
    13, 12, 11, 10, 10, 9, 8, 8, 7, 6, 6, 5, 5, 4, 4, 4, 3, 3, 3, 3, 2, 2,
    2, 2, 2, 2,
]


def grid() -> str:
    """눈금마다 세로 hairline. 회차 줄이 어느 %p에 걸리는지 읽으려면 격자가 필요하다."""
    return "\n".join(
        f'    <line x1="{mx(tick)}" y1="{LANE1_Y - 8}" x2="{mx(tick)}" y2="{AXIS_Y}"'
        f' stroke="{SUBTLE}" stroke-width="1" />'
        for tick in (0.25, 0.5, 0.75, 1.0, 1.25, 1.5)
    )


def lane_national() -> str:
    """면으로 채운다. 얇은 막대 60개는 형체가 안 잡힌다."""
    peak = max(NATIONAL)
    step = (MAIN_X1 - MAIN_X0) / (len(NATIONAL) - 1)
    points = [
        f"{round(MAIN_X0 + index * step, 2)},"
        f"{round(LANE3_Y + 40 - count / peak * 40, 2)}"
        for index, count in enumerate(NATIONAL)
    ]
    base = LANE3_Y + 40
    return (
        f'    <polygon points="{MAIN_X0},{base} {" ".join(points)} {MAIN_X1},{base}"'
        f' fill="{INK}" opacity="{FAINT}" />\n'
        f'    <polyline points="{" ".join(points)}" fill="none" stroke="{INK}"'
        f' stroke-width="1.5" opacity="{HALF}" />'
    )


def axis() -> str:
    _m, _s, _i, _w, _sec, cliff = ROUNDS[SELECTED]
    out = [
        f'    <line x1="{GUTTER}" y1="{AXIS_Y}" x2="{TAIL_X1}" y2="{AXIS_Y}"'
        f' stroke="{INK}" stroke-width="1.5" opacity="{HALF}" />'
    ]
    for tick in (0.0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5):
        x = mx(tick)
        out.append(
            f'    <text x="{x}" y="{AXIS_Y + 17}" text-anchor="middle" font-size="13" font-weight="600"'
            f' fill="{MUTED}" font-family="{MONO}">+{tick:.2f}</text>'
            f'\n    <text x="{x}" y="{AXIS_Y + 33}" text-anchor="middle" font-size="13" font-weight="600"'
            f' fill="{INK}" font-family="{MONO}">{cliff + tick:.3f}</text>'
        )
    # 양 끝 라벨은 눈금 글자와 겹치므로 둘째 줄에 둔다.
    out.append(
        f'    <text x="{round((MAIN_X1 + TAIL_X1) / 2, 2)}" y="{AXIS_Y + 33}"'
        f' text-anchor="middle" font-size="13" font-weight="600" fill="{MUTED}">초과</text>'
    )
    out.append(
        f'    <text x="{LABEL_X}" y="{AXIS_Y + 17}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{MUTED}">그날 하한 위 %p</text>'
        f'\n    <text x="{LABEL_X}" y="{AXIS_Y + 33}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{MUTED}">이 회차 사정률</text>'
    )
    return "\n".join(out)


def my_mark() -> str:
    _m, _s, _i, _w, _sec, cliff = ROUNDS[SELECTED]
    x = mx(MY_RATE - cliff)
    return (
        f'    <line x1="{x}" y1="{LANE1_Y - 34}" x2="{x}" y2="{AXIS_Y}" stroke="{PRIMARY}"'
        ' stroke-width="2" />\n'
        f'    <rect x="{x - 76}" y="{LANE1_Y - 56}" width="152" height="20" rx="4"'
        f' fill="{PRIMARY}" />\n'
        f'    <text x="{x}" y="{LANE1_Y - 42}" text-anchor="middle" font-size="13" font-weight="600"'
        f' fill="oklch(1 0 0)" font-family="{MONO}">+{MY_RATE - cliff:.3f} · {MY_RATE:.3f}</text>'
    )


def lane_names() -> str:
    # 축 기준 회차는 개찰이 끝난 가장 최근 회차다. "이번"이라고 쓰면 진행 중 공고로 읽힌다.
    rows = (
        (LANE1_Y + 5, f"최근 회차 {ROUNDS[SELECTED][0]}"),
        (LANE2_Y + 5, f"지난 낙찰 {len(ROUNDS)}회"),
        (LANE3_Y + 36, "전국 분포"),
    )
    return "\n".join(
        f'    <text x="{LABEL_X}" y="{y}" text-anchor="end" font-size="13" font-weight="600"'
        f' fill="{MUTED}">{name}</text>'
        for y, name in rows
    )


def chart() -> str:
    """viewBox 폭을 렌더 폭과 같게 둔다. 축소되면 글자가 7px로 뭉개진다."""
    height = AXIS_Y + 44
    return f"""      <svg viewBox="0 0 {VIEW_W:.0f} {height:.0f}" width="{VIEW_W:.0f}"
        height="{height:.0f}" role="img" style="display: block; max-width: 100%;"
        aria-label="그날 하한 위 %p 축 위의 낙찰과 전체 투찰">
{grid()}
{lane_national()}
{cliff_line()}
{lane_this_round()}
{lane_wins()}
{axis()}
{my_mark()}
{lane_names()}
      </svg>"""


def resolution_note() -> str:
    return (
        f"1%p = {PPU:.0f}px 고정 · 2등 격차 중앙 0.061%p = {0.061 * PPU:.0f}px ·"
        f" p25 0.016 = {0.016 * PPU:.0f}px"
    )
