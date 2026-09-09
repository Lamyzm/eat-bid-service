"""모듈 책임: source 경계 밖으로 나가는 실패를 계약 위반과 일시 장애로 갈라 놓는다."""

from __future__ import annotations


class SourceContractError(RuntimeError):
    """The source response violates a contract required for safe processing."""

    def __init__(self, message: str, *, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class SourceUnavailableError(RuntimeError):
    """왜: 연결 실패와 timeout은 소스가 계약을 어긴 관측이 아니라 응답 자체가 없었던 사건이다.
    같은 exit code로 묶으면 운영이 '다시 실행하면 되는 장애'와 '코드를 고쳐야 하는 계약 위반'을
    구분하지 못한다. 이미 상한까지 재시도했다는 사실을 시도 횟수로 함께 남긴다."""

    def __init__(self, message: str, *, attempts: int) -> None:
        super().__init__(message)
        self.attempts = attempts
