"""모듈 책임: 코드 라벨 대조에 쓰는 정규화 규칙 하나의 단일 권위를 갖는다.

이 함수가 한 곳에만 있어야 하는 이유는, 정규화가 곧 "무엇을 같다고 볼 것인가"의 정의이기 때문이다.
투영과 매핑이 각자 정규화를 적으면 한쪽이 조금 더 관대해지는 순간 그 차이가 곧 잘못된 매핑이 된다.
규칙은 공백 정리 하나뿐이며 유사도·부분 문자열·주소 파싱은 여기에 들어오지 않는다(PDR-0001, ADR 0035).
"""

from __future__ import annotations

import re

_WHITESPACE_RUN = re.compile(r"\s+")
_SLASH_PADDING = re.compile(r"\s*/\s*")


def normalize_code_label(label: str) -> str:
    """양끝 공백 제거, 연속 공백 축약, 슬래시 주변 공백 제거까지만 한다.

    실측 근거: 행안부 전체자료 53,387행 중 4행이 이름 뒤에 공백을 달고 오고(`경기도 부천시 원미구 `),
    eaT `PDLC_NM`의 이름 다중 79건은 전부 `서울 / 전체`와 `서울/전체`의 변이다.
    """
    return _SLASH_PADDING.sub("/", _WHITESPACE_RUN.sub(" ", label).strip())


def label_path_segments(label: str) -> tuple[str, ...]:
    """계층 이름 경로를 토막의 tuple로 돌려준다.

    조립한 문자열 키(`'{시도}|{시군구}'`)를 만들지 않는 이유는 그 키가 곧 새 어휘가 되기 때문이다
    (AGENTS 2). 토막의 tuple은 표기 변이를 흡수하지 않으므로 "이 소스가 이 이름으로 불렀다"가
    그대로 남고, 맞지 않으면 결측으로 드러난다.
    """
    return tuple(normalize_code_label(label).split(" "))


def label_path_parent(label: str) -> str | None:
    """계층 이름 경로의 상위 라벨을 돌려준다. 토막이 하나뿐이면 상위가 없다.

    행안부 법정동명은 `경기도 수원시 장안구`처럼 상위를 앞에 붙인 전체 경로다. 상위를 코드 문자열
    자르기로 얻지 않는 이유는 ADR 0035 결정 3에 있다 — 계층은 release가 말한 사실이지 코드의 성질이
    아니다. 여기서 얻는 것은 **후보 이름**일 뿐이고 실제 상위는 같은 release에서 유일할 때만 정해진다.
    """
    segments = normalize_code_label(label).split(" ")
    if len(segments) < 2:
        return None
    return " ".join(segments[:-1])
