"""모듈 책임: 어느 mart를 어떤 순서로 다시 만들지 정하고 개시·검증·활성화를 한 흐름으로 잇는다.

"영향 범위"는 어느 행을 고칠지가 아니라 어느 mart를 통째로 다시 만들지의 문제다. mart 안에서는
전량을 새 build로 만든다(ADR 0034).
"""

from __future__ import annotations

from collections.abc import Callable, Sequence

from eatbid.mart.models import MART_NAMES, MartBuildPlan, MartBuildResult, MartName
from eatbid.mart.repository import MartBuildContractError, MartBuildRepository

# 스냅샷의 입력은 release의 목록 관측(R2 raw)이지 발행의 record type이 아니므로 발행을 만든 run의 mode가
# 고른다.
OPEN_AUCTION_MARTS: tuple[MartName, ...] = ("open_auction_snapshot",)

# 스냅샷은 "지금 열린 공고"의 목록 관측에서만 만든다. backfill·replay(원 release가 무엇이든)·
# reference 발행이 스냅샷 활성 build를 물리면 마감된 과거 공고 build가 오늘 화면을 비운다(EAT-98).
# 모드를 모르는 run도 같은 이유로 스냅샷을 만들지 않는다.
OPEN_AUCTION_RUN_MODES: frozenset[str] = frozenset({"poll-open", "daily-reconcile"})

# 과거 기록 mart다. core 전량을 다시 읽어 수십만~백만 행을 새 build로 쓰므로 발행마다 만들지 않고
# `eatbid-history-marts` 예약이 정해진 시각에 한 번 만든다(ADR 0060). 발행 DAG는 스냅샷만 만든다.
HISTORY_MARTS: tuple[MartName, ...] = tuple(
    name for name in MART_NAMES if name not in OPEN_AUCTION_MARTS
)


def resolve_marts(
    *, requested: Sequence[str] | None, run_mode: str | None
) -> tuple[MartName, ...]:
    """발행 하나 뒤에 다시 만들 mart를 고른다.

    이름을 직접 받으면 그대로 쓴다. 열린 공고를 읽는 run(`OPEN_AUCTION_RUN_MODES`)이면 스냅샷만 만든다 —
    과거 기록 mart를 여기서 함께 만들던 때 poll-open 한 회차가 36~46분이 되어 10분 예약의 사이 회차가
    건너뛰어졌다(ADR 0060). 그 밖의 run은 발행 DAG가 이 명령을 부르지 않으며, 사람이 발행을 주고 직접
    부른 경우에만 여기 온다. 그때는 그 발행을 반영한 과거 기록 mart를 만든다 — 예약을 기다리지 않고 한 발행을
    바로 반영하려는 것이 사람이 부르는 이유다.
    """
    if requested:
        return tuple(_require_known(name) for name in requested)
    if run_mode in OPEN_AUCTION_RUN_MODES:
        return OPEN_AUCTION_MARTS
    return HISTORY_MARTS


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
