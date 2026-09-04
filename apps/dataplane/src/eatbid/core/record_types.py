"""모듈 책임: core 투영이 받아들이는 정규화 record type의 단일 권위를 둔다."""

from __future__ import annotations

# EAT-43이 core 테이블과 projector를 만들기 전까지 `auction.v2`는 발행 대상이 아니다. 조용히 v1로
# 오해석되면 명단 없는 공고로 core에 들어간다.
#
# 왜 한 상수인가. 이 판정은 발행 진입(`pipeline.project`), foundation 종단 검사, PostgreSQL topology
# 불변식 세 곳에서 각각 필요하다. 문자열이 셋으로 흩어져 있으면 새 record type을 열 때 한 곳만 열려
# 나머지 둘이 조용히 막는 상태가 생기고, 그 실패는 발행 시점에야 드러난다.
PROJECTABLE_RECORD_TYPES = frozenset({"auction.v1"})


def is_projectable_record_type(record_type: str) -> bool:
    return record_type in PROJECTABLE_RECORD_TYPES
