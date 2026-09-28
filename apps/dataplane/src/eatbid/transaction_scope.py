"""모듈 책임: 공유 psycopg 연결이 트랜잭션을 열 수 있는 빈 상태인지 판정하고, 남은 트랜잭션을 되감는 규칙을 한 곳에 둔다.

dataplane CLI는 프로세스 하나가 연결 하나를 모든 저장소와 나눠 쓴다. 남이 연 트랜잭션 위에서 블록을
열면 psycopg가 그 블록을 savepoint로 바꾸고, 바깥이 되감길 때 우리 쓰기가 성공한 채로 사라진다
(EAT-264·273·274). 이 판정이 저장소마다 복사되어 있던 것을 여기로 모은다(ADR 0059 2단계).
"""

from __future__ import annotations

from typing import Any

from psycopg.pq import TransactionStatus

# 되감을 수 있는 상태만 고른다. 끊긴 연결(UNKNOWN)은 rollback이 다시 실패하고, 서버 쪽 잠금은 세션과
# 함께 이미 풀렸으므로 건드리지 않는다. ACTIVE는 명령이 돌아온 뒤에는 나올 수 없는 상태다.
_ROLLBACK_STATES = frozenset({TransactionStatus.INTRANS, TransactionStatus.INERROR})


class UncommittedStepError(RuntimeError):
    """명령 하나가 끝났는데 공유 연결에 트랜잭션이 열린 채 남아 있다.

    psycopg는 연결을 닫을 때 그 트랜잭션을 조용히 되감으므로, 그대로 두면 명령이 exit 0으로 성공을
    보고하면서 행은 하나도 남지 않는다(EAT-264). 같은 연결을 이어 쓰는 다음 명령(chunk의 다음 건)은
    그 위에서 savepoint를 열게 된다.
    """


def require_idle(connection: Any, *, message: str, error_type: type[Exception]) -> None:
    """연결이 IDLE이 아니면 `error_type(message)`로 멈춘다.

    오류 타입과 문장을 호출자가 정하는 이유는 저장소마다 이미 자기 계약 위반 이름을 갖고 있고, 운영자와
    시험이 그 이름으로 원인을 가르기 때문이다. 판정 규칙만 여기서 하나로 둔다.
    """
    if connection.info.transaction_status != TransactionStatus.IDLE:
        raise error_type(message)


def rollback_leftover(connection: Any) -> TransactionStatus | None:
    """연결에 되감을 수 있는 트랜잭션이 남아 있으면 되감고, 되감기 전 상태를 돌려준다.

    실패를 별도 연결로 기록하기 **전에** 불러야 한다. 원 연결이 쥔 행 잠금을 별도 연결이 끝없이
    기다리기 때문이다(ADR 0059 결정 2). 남은 것이 없으면 None이다.
    """
    status = connection.info.transaction_status
    if status not in _ROLLBACK_STATES:
        return None
    connection.rollback()
    return status
