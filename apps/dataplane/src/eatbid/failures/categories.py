"""모듈 책임: run·source release의 failure_category 어휘와 예외→카테고리→exit code 대응을 소유한다."""

from __future__ import annotations

from collections.abc import Mapping

CONFIGURATION = "CONFIGURATION"
DATA_QUARANTINED = "DATA_QUARANTINED"
TRANSIENT_NETWORK = "TRANSIENT_NETWORK"
SOURCE_THROTTLED = "SOURCE_THROTTLED"
SOURCE_CONTRACT = "SOURCE_CONTRACT"
PROJECTION_CONTRACT = "PROJECTION_CONTRACT"

# 왜: workflow 실패 파라미터와 운영 문서가 이 숫자에 묶여 있으므로 카테고리와 짝을 바꾸지 않는다.
# sysexits 자리를 그대로 써서 pod 종료 코드만 봐도 카테고리를 되짚을 수 있다. PROJECTION_CONTRACT는
# 프로세스 종료 어휘가 아니라 저장된 run 상태에만 쓰이므로 여기에 없다.
EXIT_CODE_BY_CATEGORY: Mapping[str, int] = {
    CONFIGURATION: 64,
    DATA_QUARANTINED: 65,
    TRANSIENT_NETWORK: 69,
    SOURCE_THROTTLED: 75,
    SOURCE_CONTRACT: 76,
}

# 왜: 정규화·검증에 들어가기 전에 닫힌 실패들이다. 남은 것이 보존된 raw 관측뿐이라 publication에
# 검증 시각이 없고 topology가 부분일 수 있다는 구조가 이 카테고리들에서 모두 같다. 그래서 이 모양의
# run은 원본을 다시 해석하는 replay로 복구하는 것이 옳고, 그중 TRANSIENT_NETWORK는 원인이 우리
# 해석이 아니라 전송이라 특히 재실행이 정답이다. 여기 없는 PROJECTION_CONTRACT는 이미 검증을
# 통과해 publication을 얼린 뒤의 실패라 부분 topology를 허용하면 안 된다.
PRE_VALIDATION_FAILURE_CATEGORIES: frozenset[str] = frozenset(
    {
        DATA_QUARANTINED,
        SOURCE_CONTRACT,
        SOURCE_THROTTLED,
        TRANSIENT_NETWORK,
    }
)


def failure_category_for_error(error: Exception) -> str:
    """왜: exit code와 DB failure_category가 각자 판정하면 운영자가 pod 종료 코드와 run 표에서 서로
    다른 원인을 읽는다. 두 표현이 같은 판정을 쓰도록 예외 분류를 이 한 곳에만 둔다."""
    # 이 모듈은 pipeline과 source가 함께 의존하는 어휘 소유자라, 예외 클래스를 top-level에서
    # 끌어오면 import cycle이 생긴다. 분류 시점에만 필요하므로 함수 안에서 가져온다.
    from eatbid.failures.errors import SourceContractError, SourceUnavailableError
    from eatbid.pipeline.capture import SourceThrottledError
    from eatbid.pipeline.normalize import DataQuarantinedError

    if isinstance(error, DataQuarantinedError):
        return DATA_QUARANTINED
    if isinstance(error, SourceThrottledError):
        return SOURCE_THROTTLED
    # 왜: 응답 자체가 오지 않은 일시 장애는 이미 상한까지 재시도한 뒤에만 여기 온다. 계약 위반과
    # 같은 카테고리로 묶으면 운영이 "코드를 고쳐야 하는 실패"로 오독한다.
    if isinstance(error, SourceUnavailableError):
        return TRANSIENT_NETWORK
    if isinstance(error, SourceContractError):
        return SOURCE_CONTRACT
    return CONFIGURATION
