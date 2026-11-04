/**
 * @module 책임: 공고 하나의 추천 금액을 어느 시장 자리가 맡을지 정하는 규칙(ADR 0071 결정 2)과 그 규칙의 판 이름을 소유한다.
 *
 * DB와 시계를 모르는 순수 함수다. 같은 재료에 같은 답을 내야 동시 요청이 다시 읽어 같은 결론에 닿고, 매일 확정 작업과 운영자
 * 진단 화면이 금액 요청과 같은 판정을 쓴다.
 */
import { Temporal } from "@eatbid/domain";

/** 배정 이력에 남기는 규칙 판이다. 아래 판정 순서를 바꾸면 판을 올린다. */
export const SEAT_ASSIGNMENT_RULE_VERSION = "seat-r1";

export type MarketSeatState = "held" | "active" | "reclaim" | "offer";

/** 공고의 (참가제한지역, 품목) 짝 가운데 하나라도 같은 자리다. 기간과 상태는 아직 거르지 않은 그대로다. */
export interface CoveringSeat {
  readonly marketSeatId: bigint;
  readonly workspaceId: bigint;
  readonly state: MarketSeatState;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly priorityStartedAt: Temporal.Instant;
}

export type AssignmentKind = "took" | "handed_over" | "confirmed" | "corrected";

export interface CurrentAssignment {
  readonly assignmentId: bigint;
  readonly workspaceId: bigint;
  readonly marketSeatId: bigint;
  readonly kind: AssignmentKind;
}

export interface AssignmentSituation {
  readonly at: Temporal.Instant;
  /** 최신 개정본에 품목 코드가 하나라도 있는가. 없으면 지역만으로 배정하지 않는다(ADR 0071 결정 2). */
  readonly hasItem: boolean;
  readonly deadlineAt: Temporal.Instant | null;
  readonly coveringSeats: readonly CoveringSeat[];
  readonly current: CurrentAssignment | null;
}

export type NoAssignmentReason = "no-item" | "no-seat" | "closed" | "deadline-unknown";

export type AssignmentDecision =
  | { readonly kind: "keep"; readonly current: CurrentAssignment }
  | { readonly kind: "take"; readonly seat: CoveringSeat; readonly candidates: readonly CoveringSeat[] }
  | {
      readonly kind: "hand-over";
      readonly from: CurrentAssignment;
      readonly seat: CoveringSeat;
      readonly candidates: readonly CoveringSeat[];
    }
  /** 맡은 자리가 끝났는데 다음 후보가 없다. 줄을 닫지 않으면 끝난 업체가 계속 금액을 받는다. */
  | { readonly kind: "vacate"; readonly from: CurrentAssignment }
  | { readonly kind: "none"; readonly reason: NoAssignmentReason };

function isActiveAt(seat: CoveringSeat, at: Temporal.Instant): boolean {
  // 기간은 반열림 [시작, 끝)이다. 선점·되찾기·제안 상태는 자리를 막을 뿐 금액을 받지 않는다(PDR-0010 결정 4).
  return seat.state === "active"
    && Temporal.Instant.compare(seat.startsAt, at) <= 0
    && Temporal.Instant.compare(at, seat.endsAt) < 0;
}

function byPriority(left: CoveringSeat, right: CoveringSeat): number {
  const order = Temporal.Instant.compare(left.priorityStartedAt, right.priorityStartedAt);
  if (order !== 0) return order;
  return left.marketSeatId < right.marketSeatId ? -1 : left.marketSeatId > right.marketSeatId ? 1 : 0;
}

/**
 * 판정 순서가 곧 규칙이다.
 *
 * 1. 마감 뒤 확정·운영자 정정된 줄은 금액 요청이 바꾸지 않는다. 바꾸는 길은 정정 줄뿐이다(결정 4).
 * 2. 품목 코드가 없는 공고는 시범 동안 금액을 내지 않는다.
 * 3. 맡은 자리가 살아 있고 여전히 걸치면 마감까지 그대로 간다(sticky). 더 이른 우선권 자리가 새로 생겨도 빼앗지 않는다.
 * 4. 마감이 지났거나 마감 시각을 모르면 새로 맡지 않는다. 모르는 것을 열림으로 추측하지 않는다(AGENTS 3).
 * 5. 남은 후보 가운데 우선권 시작일이 이른 자리, 같으면 번호가 작은 자리가 맡는다.
 */
export function decideSeatAssignment(situation: AssignmentSituation): AssignmentDecision {
  const { at, current } = situation;
  if (current !== null && (current.kind === "confirmed" || current.kind === "corrected")) {
    return { kind: "keep", current };
  }
  if (!situation.hasItem) {
    return current === null ? { kind: "none", reason: "no-item" } : { kind: "vacate", from: current };
  }

  const candidates = situation.coveringSeats.filter((seat) => isActiveAt(seat, at)).sort(byPriority);
  if (current !== null && candidates.some((seat) => seat.marketSeatId === current.marketSeatId)) {
    return { kind: "keep", current };
  }

  if (situation.deadlineAt === null) {
    return current === null ? { kind: "none", reason: "deadline-unknown" } : { kind: "keep", current };
  }
  if (Temporal.Instant.compare(at, situation.deadlineAt) >= 0) {
    // 마감 뒤에는 넘기지도 비우지도 않는다. 마감 시각에 맡고 있던 업체를 확정하는 것은 매일 작업의 일이다.
    return current === null ? { kind: "none", reason: "closed" } : { kind: "keep", current };
  }

  const [seat] = candidates;
  if (seat === undefined) {
    return current === null ? { kind: "none", reason: "no-seat" } : { kind: "vacate", from: current };
  }
  return current === null
    ? { kind: "take", seat, candidates }
    : { kind: "hand-over", from: current, seat, candidates };
}
