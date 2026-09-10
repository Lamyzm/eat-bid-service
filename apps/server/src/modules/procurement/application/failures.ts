/** @module 책임: procurement 모듈의 use case들이 공유하는 자원 무관 typed failure를 소유한다. */

/**
 * 저장소·mart 같은 의존성이 응답하지 못한 실패다. 공고·기관·분포·내 투찰 어느 조회에서도 같은 뜻이라
 * 모듈 이름을 달고, 자원 이름을 단 실패(`AuctionDependencyUnavailable`)는 그 자원의 조회만 던진다
 * (ADR 0045 결정 5). 공개 Problem Details는 `DEPENDENCY_UNAVAILABLE` 503 하나이며 원인 예외는
 * `cause`로만 남겨 본문과 문장에 새지 않는다.
 */
export class ProcurementDependencyUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Procurement repository is unavailable", { cause });
    this.name = "ProcurementDependencyUnavailable";
  }
}
