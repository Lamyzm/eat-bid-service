"""모듈 책임: 정규화 격리 하나가 레코드 범위라 발행에서 뺄 수 있는지와 한 발행이 뺄 수 있는 수를 정하는
ADR 0061의 정책(범위 분류표와 허용 수)을 소유한다.
"""

from __future__ import annotations

__all__ = [
    "EXCLUSION_CAP",
    "EXCLUSION_RATIO_PERCENT",
    "RECORD_SCOPED_REASONS",
    "allowed_exclusions",
    "record_scoped_reason_code",
]

# ADR 0061 결정 3의 정책 숫자다. 바꾸려면 그 ADR을 대체한다 — 상한을 넘은 발행이 실패하는 순간이 곧
# 계약·파서 결함의 신호이므로 이 값은 운영 편의로 늘리는 손잡이가 아니다.
EXCLUSION_CAP = 50
EXCLUSION_RATIO_PERCENT = 1

# 격리 사유 문장의 머리 → 원장 사유 코드. 여기 열거된 것만 레코드 범위다(ADR 0061 결정 2).
#
# 왜 문장의 머리로 가르나: 격리 시도에는 사유 문장만 저장되고 분류 열이 없다(ADR 0014의 시도 행). 문장은
# `source/eat/xml.py`의 `NexacroParseError`와 `source/eat/normalize.py`의 `EatDetailValidationError`가 소유하며,
# 둘 다 관측 하나의 바이트만 보고 던진다 — 그 관측 밖의 사실을 모른다. 그래서 이 문장들은 범위가 그 한 건에
# 갇혀 있다.
#
# **목록에 없는 문장은 레코드 범위가 아니다.** 새 격리 사유가 생기거나 문구가 바뀌면 이 표에 더하기 전까지는
# 창 전체 실패로 떨어진다. 범위를 잘못 넓게 보면 결손이 조용히 늘고(ADR 0061 Consequences), 잘못 좁게 보면
# 오늘처럼 창이 실패해 사람이 본다. 틀릴 거라면 시끄러운 쪽으로 틀린다.
RECORD_SCOPED_REASONS: tuple[tuple[str, str], ...] = (
    # XML 자체가 깨졌다(기관이 넣은 꺾쇠, 잘린 응답). 2026-09 실측의 "Nexacro가 한 공고에서 깨진 것"이다.
    ("unsafe or malformed Nexacro XML", "SOURCE_XML_BROKEN"),
    # XML은 읽혔지만 그 응답의 Nexacro dataset 구조가 깨졌다(중복 dataset·column, 빈 id 등).
    ("Nexacro Root namespace", "SOURCE_NEXACRO_SHAPE"),
    ("Dataset id is required", "SOURCE_NEXACRO_SHAPE"),
    ("duplicate Dataset id", "SOURCE_NEXACRO_SHAPE"),
    ("duplicate ColumnInfo", "SOURCE_NEXACRO_SHAPE"),
    ("ColumnInfo column id is required", "SOURCE_NEXACRO_SHAPE"),
    ("duplicate column id", "SOURCE_NEXACRO_SHAPE"),
    ("duplicate Rows", "SOURCE_NEXACRO_SHAPE"),
    ("row column id is required", "SOURCE_NEXACRO_SHAPE"),
    ("undeclared column id", "SOURCE_NEXACRO_SHAPE"),
    ("invalid row fragment", "SOURCE_NEXACRO_SHAPE"),
    ("at least one Nexacro Dataset", "SOURCE_NEXACRO_SHAPE"),
    # 공고 상세가 한 행이 아니다(삭제된 공고의 빈 응답 등). 그 공고 하나의 사정이다.
    ("ds_info must contain exactly one row", "SOURCE_DETAIL_SHAPE"),
    # 구조는 맞지만 한 칸이 정체성·필수 사실의 계약을 어겼다(ADR 0056 결정 2의 관용 밖 칸).
    ("invalid eaT detail field", "RECORD_CONTRACT_VIOLATION"),
)


def record_scoped_reason_code(quarantine_reason: str) -> str | None:
    """레코드 범위로 열거된 격리 사유면 원장의 사유 코드를, 아니면 `None`을 돌려준다.

    `None`은 "모른다"가 아니라 "창 전체 결함으로 다룬다"는 판정이다. 호출자는 그것을 제외로 바꾸지 않는다.
    """
    for prefix, code in RECORD_SCOPED_REASONS:
        if quarantine_reason.startswith(prefix):
            return code
    return None


def allowed_exclusions(expected_count: int) -> int:
    """한 발행이 원장에 적고 뺄 수 있는 레코드 수 `min(50, max(1, floor(1% × N)))`이다(ADR 0061 결정 3).

    하한 1은 작은 발행(poll-open 한 회차 수십 건)에서도 우연한 한 건이 회차 전체를 가리지 않게 하려는 것이고,
    상한 50은 파서 회귀 하나가 큰 창의 절반을 조용히 빼도 발행이 성공하는 일을 막는다. N=0이면 뺄 레코드가
    애초에 없으므로 하한 1은 쓰이지 않는다.
    """
    if (
        isinstance(expected_count, bool)
        or not isinstance(expected_count, int)
        or expected_count < 0
    ):
        raise ValueError("expected_count must be a nonnegative integer")
    return min(EXCLUSION_CAP, max(1, expected_count * EXCLUSION_RATIO_PERCENT // 100))
