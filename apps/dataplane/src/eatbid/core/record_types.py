"""모듈 책임: core 투영이 받아들이는 정규화 record type의 단일 권위를 둔다."""

from __future__ import annotations

# 왜 한 상수인가. 이 판정은 발행 진입(`pipeline.project`), foundation 종단 검사, PostgreSQL topology
# 불변식 세 곳에서 각각 필요하다. 문자열이 셋으로 흩어져 있으면 새 record type을 열 때 한 곳만 열려
# 나머지 둘이 조용히 막는 상태가 생기고, 그 실패는 발행 시점에야 드러난다.
# 이름 자체도 상수로 둔다. 발행 가능 목록과 record type별 빌더 표가 각각 문자열을 적으면 둘이
# 어긋나는 순간 "발행은 되는데 빌더가 없는" record type이 생긴다.
AUCTION_V1 = "auction.v1"
AUCTION_V2 = "auction.v2"

# `auction.v2`는 EAT-43이 명단·낙찰·업체·사슬 core 테이블과 그 projector를 만든 뒤 열렸다
# (ADR 0033 §5). v1 발행은 명단 블록이 없으므로 지금도 attempt·revision만 쓴다.
PROJECTABLE_RECORD_TYPES = frozenset({AUCTION_V1, AUCTION_V2})


def is_projectable_record_type(record_type: str) -> bool:
    return record_type in PROJECTABLE_RECORD_TYPES
