"""모듈 책임: source 경계 밖으로 나가는 실패를 계약 위반·일시 장애·기록된 발행 실패로 갈라 놓는다."""

from __future__ import annotations

from uuid import UUID


class PublicationFailedError(RuntimeError):
    """왜: validate가 publication을 실패로 기록하고도 프로세스가 0으로 끝나면 DAG가 project로 이어져
    엉뚱한 자리에서 설정 오류(64)로 죽는다. ledger에 남긴 category를 그대로 exit code로 옮기는
    typed failure다. 메시지에는 정체성만 싣고 provider 상세는 싣지 않는다."""

    def __init__(self, failure_category: str, *, publication_id: UUID) -> None:
        super().__init__(f"publication {publication_id} failed with {failure_category}")
        self.failure_category = failure_category
        self.publication_id = publication_id


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
