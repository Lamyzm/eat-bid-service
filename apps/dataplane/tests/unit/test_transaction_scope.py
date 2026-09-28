"""공유 연결의 IDLE 판정과 남은 트랜잭션 되감기가 저장소마다 같은 규칙으로 동작하는지 고정한다(ADR 0059)."""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest
from psycopg.pq import TransactionStatus

from eatbid.core.repository import ProjectionTransactionScopeError
from eatbid.ingest.postgres_replay_repository import ReplayTransactionScopeError
from eatbid.ingest.release_repository import ReleaseIsolationContractError
from eatbid.mart.repository import MartTransactionScopeError
from eatbid.transaction_scope import require_idle, rollback_leftover


@dataclass
class _연결정보:
    transaction_status: TransactionStatus


@dataclass
class _가짜연결:
    """판정에 쓰이는 상태와 rollback 호출만 흉내 낸다."""

    status: TransactionStatus
    rollbacks: int = 0
    info: _연결정보 = field(init=False)

    def __post_init__(self) -> None:
        self.info = _연결정보(self.status)

    def rollback(self) -> None:
        self.rollbacks += 1
        self.info.transaction_status = TransactionStatus.IDLE


@pytest.mark.parametrize(
    "error_type",
    [
        ProjectionTransactionScopeError,
        ReleaseIsolationContractError,
        ReplayTransactionScopeError,
        MartTransactionScopeError,
    ],
)
@pytest.mark.parametrize(
    "status",
    [TransactionStatus.INTRANS, TransactionStatus.INERROR, TransactionStatus.UNKNOWN],
)
def test_비어_있지_않은_연결은_저장소가_정한_오류_타입과_문장으로_멈춘다(
    error_type: type[Exception], status: TransactionStatus
) -> None:
    connection = _가짜연결(status)

    with pytest.raises(error_type, match="^저장소 고유 문장$"):
        require_idle(connection, message="저장소 고유 문장", error_type=error_type)

    # 판정만 하고 연결을 건드리지 않는다. 남의 트랜잭션을 멋대로 되감으면 그 쓰기가 사라진다.
    assert connection.rollbacks == 0


def test_비어_있는_연결은_그대로_통과한다() -> None:
    require_idle(
        _가짜연결(TransactionStatus.IDLE),
        message="쓰이면 안 되는 문장",
        error_type=MartTransactionScopeError,
    )


@pytest.mark.parametrize(
    "status", [TransactionStatus.INTRANS, TransactionStatus.INERROR]
)
def test_남은_트랜잭션은_되감고_되감기_전_상태를_돌려준다(
    status: TransactionStatus,
) -> None:
    connection = _가짜연결(status)

    assert rollback_leftover(connection) is status
    assert connection.rollbacks == 1
    assert connection.info.transaction_status is TransactionStatus.IDLE


@pytest.mark.parametrize(
    "status", [TransactionStatus.IDLE, TransactionStatus.UNKNOWN]
)
def test_비어_있거나_끊긴_연결은_되감지_않는다(status: TransactionStatus) -> None:
    """끊긴 연결은 rollback이 다시 실패하고, 서버 쪽 잠금은 세션과 함께 이미 풀렸다."""
    connection = _가짜연결(status)

    assert rollback_leftover(connection) is None
    assert connection.rollbacks == 0
