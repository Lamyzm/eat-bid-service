"""모듈 책임: mart 빌드 한 번의 입력 계획과 machine result 모양을 둔다.

계획은 `mart.build` 원장 한 행이 되는 값들이고 결과는 workflow가 파일로 읽는 값들이다.
계산 규칙 자체는 mart별 빌더가, 상태 전환은 repository가 소유한다.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal, get_args
from uuid import UUID

MartName = Literal[
    "org_round_summary", "win_rate_distribution_monthly", "open_auction_snapshot"
]

MART_NAMES: tuple[MartName, ...] = get_args(MartName)

MartBuildStatus = Literal["building", "verified", "active", "superseded", "failed"]

# 지역 축의 기본 코드 체계다. 행정안전부 코드를 적재한 뒤에는 새 calc_version의 새 build가
# 다른 namespace로 만들어지며, 그 사실은 `mart.build.region_scheme`이 기록한다(AGENTS 6, ADR 0034).
DEFAULT_REGION_SCHEME = "eat:auction-location-sigungu"


@dataclass(frozen=True, slots=True)
class MartBuildPlan:
    """빌드 하나의 봉인된 입력이다. 같은 계획으로 두 번 부르면 같은 build 하나가 된다."""

    mart_name: MartName
    source_release_id: UUID
    publication_id: UUID | None
    calc_version: str
    builder_version: str
    # 목록 관측을 다시 읽는 mart가 검토된 파서 계약을 고를 때 쓴다. 여기서 version을 고정하면
    # 새 계약으로 수집한 관측을 옛 필수 column으로 검증하게 되고 그 어긋남은 한참 뒤에 드러난다.
    parser_version: str
    region_scheme: str | None
    as_of: datetime
    started_at: datetime
    computed_at: datetime


@dataclass(frozen=True, slots=True)
class MartBuildResult:
    mart_name: MartName
    build_id: int
    row_count: int
    status: MartBuildStatus


@dataclass(frozen=True, slots=True)
class OpenedMartBuild:
    build_id: int
    # 이미 활성인 build를 다시 만난 경우다. 행을 다시 쌓지 않고 그대로 둔다.
    already_active: bool
