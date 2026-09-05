"""모듈 책임: 어느 mart를 어떤 순서로 다시 만들지 정하고 개시·검증·활성화를 한 흐름으로 잇는다.

"영향 범위"는 어느 행을 고칠지가 아니라 어느 mart를 통째로 다시 만들지의 문제다. mart 안에서는
전량을 새 build로 만든다(ADR 0034).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Protocol
from uuid import UUID

from eatbid.core.record_types import AUCTION_V1, AUCTION_V2
from eatbid.mart.models import MART_NAMES, MartBuildPlan, MartBuildResult, MartName
from eatbid.mart.repository import MartBuildContractError, MartBuildRepository

# 발행이 실은 record type이 어느 mart의 입력을 바꾸는가.
# `auction.v1`에는 명단이 없어 분포의 입력이 생기지 않는다. 목록 관측만 담긴 발행은 오늘 화면만
# 바꾼다. 이 표가 영향 범위의 단일 권위이며 workflow YAML이 같은 판단을 따로 하지 않는다.
IMPACT_SCOPE: dict[str, tuple[MartName, ...]] = {
    AUCTION_V1: ("org_round_summary",),
    AUCTION_V2: ("org_round_summary", "win_rate_distribution_monthly"),
}

# 영향 범위를 알 수 없는 발행에서도 오늘 화면은 목록 관측만 읽으므로 따로 다룬다.
OPEN_AUCTION_MARTS: tuple[MartName, ...] = ("open_auction_snapshot",)


def resolve_marts(
    *,
    requested: Sequence[str] | None,
    record_types: Sequence[str],
) -> tuple[MartName, ...]:
    """다시 만들 mart를 고른다.

    이름을 직접 받으면 그대로 쓴다. 발행이 실은 record type을 알면 영향 범위만 고르고, 아무 단서가
    없으면 셋 다 다시 만든다. 모르는 record type을 만나면 조용히 무시하지 않고 셋 다 만든다 —
    새 record type이 생겼을 때 화면이 옛 build를 계속 읽는 것보다 다시 만드는 편이 안전하다.
    """
    if requested:
        return tuple(_require_known(name) for name in requested)
    if not record_types:
        return MART_NAMES
    if any(record_type not in IMPACT_SCOPE for record_type in record_types):
        return MART_NAMES
    scoped: list[MartName] = []
    for record_type in record_types:
        for mart_name in IMPACT_SCOPE[record_type]:
            if mart_name not in scoped:
                scoped.append(mart_name)
    return tuple(scoped)


def _require_known(name: str) -> MartName:
    if name not in MART_NAMES:
        raise MartBuildContractError(f"unknown mart name [mart={name}]")
    return name  # type: ignore[return-value]


def build_mart(
    plan: MartBuildPlan, repository: MartBuildRepository, *, failure_category: str
) -> MartBuildResult:
    """mart 하나를 새 build로 만들고 활성으로 옮긴다. 실패는 활성 포인터를 움직이지 않는다."""
    opened = repository.open_build(plan)
    if opened.status == "active":
        # 같은 봉인된 입력·같은 계산 규칙의 결과가 이미 공개 중이다. 다시 만들 이유가 없다.
        return MartBuildResult(
            mart_name=plan.mart_name,
            build_id=opened.build_id,
            row_count=opened.row_count or 0,
            status="active",
        )
    try:
        row_count = opened.row_count or 0
        if opened.status == "building":
            row_count = repository.fill_build(plan, opened.build_id)
            repository.verify_build(plan, opened.build_id, row_count)
        repository.activate_build(plan, opened.build_id)
    except Exception:
        repository.fail_build(opened.build_id, failure_category)
        raise
    return MartBuildResult(
        mart_name=plan.mart_name,
        build_id=opened.build_id,
        row_count=row_count,
        status="active",
    )


def build_marts(
    *,
    marts: Sequence[MartName],
    plan_for: Callable[[MartName], MartBuildPlan],
    repository: MartBuildRepository,
    failure_category: str = "CONFIGURATION",
) -> tuple[MartBuildResult, ...]:
    return tuple(
        build_mart(plan_for(mart_name), repository, failure_category=failure_category)
        for mart_name in marts
    )


class PublicationRecordTypeReader(Protocol):
    def publication_marts(self, publication_id: UUID) -> tuple[str, ...]: ...


def publication_record_types(
    repository: PublicationRecordTypeReader, publication_id: UUID | None
) -> tuple[str, ...]:
    """발행이 실은 record type을 읽는다. 발행이 없으면 영향 범위 단서도 없다."""
    return () if publication_id is None else repository.publication_marts(publication_id)
