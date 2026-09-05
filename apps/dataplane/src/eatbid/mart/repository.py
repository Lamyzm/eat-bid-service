"""모듈 책임: mart 빌드가 저장소에 요구하는 port와 그 계약 위반의 이름을 둔다.

구현이 여기 없는 이유는 이 계약을 PostgreSQL 어댑터와 테스트 fake가 함께 지키기 때문이다.
"""

from __future__ import annotations

from typing import Protocol

from eatbid.mart.models import MartBuildPlan, OpenedMartBuild


class MartBuildContractError(RuntimeError):
    """mart 빌드 입력이나 상태 전환이 build 원장의 계약과 어긋난다."""


class MartBuildRepository(Protocol):
    def open_build(self, plan: MartBuildPlan) -> OpenedMartBuild:
        """멱등 키로 build를 찾거나 만들고, 재개 가능한 build의 이전 행을 지운다."""
        ...

    def fill_build(self, plan: MartBuildPlan, build_id: int) -> int:
        """그 mart의 계산 규칙으로 행을 전부 다시 만들고 적재한 행 수를 돌려준다."""
        ...

    def verify_build(self, plan: MartBuildPlan, build_id: int, row_count: int) -> None:
        """저장된 행을 다시 세어 맞으면 행 수를 고정하고 `building → verified`로 옮긴다."""
        ...

    def activate_build(self, plan: MartBuildPlan, build_id: int) -> None:
        """이전 active를 물리고 새 build를 활성으로 바꾼다. 한 트랜잭션이어야 한다."""
        ...

    def fail_build(self, build_id: int, failure_category: str) -> None:
        """실패를 별도 연결의 트랜잭션에서 내구화한다. 활성 포인터는 움직이지 않는다."""
        ...


class MartBuilder(Protocol):
    """mart 하나의 계산 규칙이다. 행 단위 증분을 만들지 않고 전량을 다시 만든다."""

    def __call__(self, connection: object, *, plan: MartBuildPlan, build_id: int) -> int: ...
