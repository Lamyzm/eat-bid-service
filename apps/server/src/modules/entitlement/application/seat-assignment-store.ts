/**
 * @module 책임: 공고 배정 use case가 판정 재료를 읽고 배정 이력을 쓰는 port와 그 record 형태를 소유한다.
 */
import type { Temporal } from "@eatbid/domain";

import type { AssignmentSituation, CoveringSeat, CurrentAssignment } from "../domain/seat-assignment";

export interface AssignmentBasis {
  readonly situation: AssignmentSituation;
  /** 판정에 쓴 최신 개정본의 관측 번호다. 정정공고가 반영됐는지 나중에 되짚는 열쇠다. */
  readonly basisObservationId: bigint;
}

export interface TakeAssignmentInput {
  readonly auctionAttemptId: bigint;
  readonly seat: CoveringSeat;
  readonly candidates: readonly CoveringSeat[];
  readonly basisObservationId: bigint;
  readonly ruleVersion: string;
  readonly recordedAt: Temporal.Instant;
}

/**
 * 쓰기 셋은 모두 "이미 누가 했으면 아무것도 하지 않는다"로 끝난다. 동시 요청 둘이 같은 판정에 닿아도 줄이 둘 생기지 않게
 * 하는 것은 이 port의 구현이 DB 제약으로 지키고, 이긴 쪽이 누구인지는 use case가 `readCurrent`로 다시 읽어 안다.
 */
export interface SeatAssignmentStore {
  /** 공고가 없으면 `null`이다. 자리는 공고의 (지역, 품목) 짝에 걸친 것을 상태·기간 거르지 않고 싣는다. */
  readBasis(input: { readonly auctionAttemptId: bigint; readonly at: Temporal.Instant }): Promise<AssignmentBasis | null>;
  readCurrent(auctionAttemptId: bigint): Promise<CurrentAssignment | null>;
  /** 지금 줄이 없을 때만 `took` 줄을 더한다. */
  take(input: TakeAssignmentInput): Promise<void>;
  /** `from`이 아직 지금 줄일 때만 닫고 `handed_over` 줄을 더한다. 한 transaction이다. */
  handOver(input: TakeAssignmentInput & { readonly from: CurrentAssignment }): Promise<void>;
  /** `from`이 아직 지금 줄일 때만 닫는다. 새 줄은 더하지 않는다. */
  vacate(input: { readonly from: CurrentAssignment; readonly at: Temporal.Instant }): Promise<void>;
}
