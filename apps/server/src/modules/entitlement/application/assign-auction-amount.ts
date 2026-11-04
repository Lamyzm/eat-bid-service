/**
 * @module 책임: 공고 하나의 추천 금액을 지금 어느 워크스페이스가 맡는지 판정하고, 금액을 내보내기 전에 그 판정을 기록하는 use case를
 * 소유한다(ADR 0071 결정 2·3).
 */
import { Effect } from "effect";
import type { Clock } from "@eatbid/domain";

import { decideSeatAssignment, SEAT_ASSIGNMENT_RULE_VERSION, type NoAssignmentReason } from "../domain/seat-assignment";
import type { SeatAssignmentStore } from "./seat-assignment-store";

export type AuctionAmountAssignment =
  | { readonly kind: "assigned"; readonly workspaceId: bigint; readonly marketSeatId: bigint }
  | { readonly kind: "unassigned"; readonly reason: NoAssignmentReason | "not-found" }
  /** 판정이나 기록이 실패했다. 금액을 내지 않는 쪽으로 닫는다. */
  | { readonly kind: "unavailable" };

/**
 * 실패를 던지지 않고 `unavailable`로 닫는다. 기록하지 못한 배정으로 금액을 내보내면 같은 공고를 두 곳이 볼 수 있어서,
 * 금액 경로는 이 결과가 `assigned`이고 요청자가 그 워크스페이스일 때만 금액을 싣는다(fail-closed). 화면 장부와 달리 이 기록의
 * 실패는 응답을 바꾼다 — 장부는 "무엇을 보였나"의 기록이지만 이 표는 "누가 볼 자격이 있나"의 권위다.
 *
 * 쓰고 나서 지금 줄을 다시 읽어 답한다. 동시 요청에 진 쪽은 자기 판정이 아니라 이긴 쪽의 줄을 보고 답해야 두 응답이 갈리지 않는다.
 */
export class AssignAuctionAmount {
  constructor(
    private readonly store: SeatAssignmentStore,
    private readonly clock: Clock,
  ) {}

  execute(input: { readonly auctionAttemptId: bigint }): Effect.Effect<AuctionAmountAssignment, never, never> {
    return Effect.promise(() => this.assign(input.auctionAttemptId).catch((): AuctionAmountAssignment => ({ kind: "unavailable" })));
  }

  private async assign(auctionAttemptId: bigint): Promise<AuctionAmountAssignment> {
    const at = this.clock.now();
    const basis = await this.store.readBasis({ auctionAttemptId, at });
    if (basis === null) return { kind: "unassigned", reason: "not-found" };

    const decision = decideSeatAssignment(basis.situation);
    const record = {
      auctionAttemptId,
      basisObservationId: basis.basisObservationId,
      ruleVersion: SEAT_ASSIGNMENT_RULE_VERSION,
      recordedAt: at,
    };
    switch (decision.kind) {
      case "keep":
        return { kind: "assigned", workspaceId: decision.current.workspaceId, marketSeatId: decision.current.marketSeatId };
      case "none":
        return { kind: "unassigned", reason: decision.reason };
      case "take":
        await this.store.take({ ...record, seat: decision.seat, candidates: decision.candidates });
        break;
      case "hand-over":
        await this.store.handOver({ ...record, from: decision.from, seat: decision.seat, candidates: decision.candidates });
        break;
      case "vacate":
        await this.store.vacate({ from: decision.from, at });
        break;
    }

    const current = await this.store.readCurrent(auctionAttemptId);
    if (current !== null) return { kind: "assigned", workspaceId: current.workspaceId, marketSeatId: current.marketSeatId };
    return { kind: "unassigned", reason: decision.kind === "vacate" && !basis.situation.hasItem ? "no-item" : "no-seat" };
  }
}
