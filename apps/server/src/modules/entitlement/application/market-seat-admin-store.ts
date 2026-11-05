/**
 * @module 책임: 운영자가 시장 자리를 주고·늘리고·거두는 use case가 쓰는 저장소 port와 내부 record·거절·실패 타입을 소유한다.
 */
import type { AuctionItemAtom } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";

import type { MarketSeatState } from "../domain/seat-assignment";

export type MarketSeatItemRecord =
  | { readonly kind: "atom"; readonly atom: AuctionItemAtom }
  | { readonly kind: "no-main-item-restriction" };

export type MarketSeatReasonRecord = "pilot" | "payment-confirmed" | "operator-correction" | "refund-request" | "other";

export type MarketSeatEventKindRecord =
  | "held" | "activated" | "extended" | "revoked" | "released" | "reclaimed" | "offered" | "corrected";

export interface OperatorWorkspaceRecord {
  readonly workspaceId: bigint;
  readonly name: string;
  readonly businessNumbers: readonly string[];
}

export interface MarketSeatEventRecord {
  readonly kind: MarketSeatEventKindRecord;
  readonly occurredAt: Temporal.Instant;
  readonly reason: MarketSeatReasonRecord;
  readonly memo: string | null;
  readonly actorPrincipalId: bigint | null;
  readonly previousEndsAt: Temporal.Instant | null;
  readonly nextEndsAt: Temporal.Instant | null;
}

export interface MarketSeatRecord {
  readonly marketSeatId: bigint;
  readonly workspace: OperatorWorkspaceRecord;
  readonly region: { readonly codeValueId: bigint; readonly code: string; readonly scheme: string; readonly label: string | null };
  readonly item: MarketSeatItemRecord;
  readonly state: MarketSeatState;
  readonly startsAt: Temporal.Instant;
  readonly endsAt: Temporal.Instant;
  readonly priorityStartedAt: Temporal.Instant;
  readonly events: readonly MarketSeatEventRecord[];
}

export type MarketSeatRejectionRecord =
  | { readonly reason: "period-overlap"; readonly holder: { readonly workspaceId: bigint; readonly name: string }; readonly holderEndsAt: Temporal.Instant }
  | { readonly reason: "business-claimed-elsewhere"; readonly businessNumber: string; readonly holder: { readonly workspaceId: bigint; readonly name: string } }
  | { readonly reason: "no-registered-business" }
  | { readonly reason: "item-not-observed" }
  | { readonly reason: "region-not-eligibility-area" }
  | { readonly reason: "start-in-past" }
  | { readonly reason: "seat-ended" }
  | { readonly reason: "memo-required" };

export type MarketSeatCommandOutcome =
  | { readonly kind: "saved"; readonly seat: MarketSeatRecord }
  | { readonly kind: "rejected"; readonly rejection: MarketSeatRejectionRecord };

export interface MarketSeatChangeNote {
  readonly actorPrincipalId: bigint;
  readonly reason: MarketSeatReasonRecord;
  readonly memo: string | null;
  readonly at: Temporal.Instant;
}

/**
 * 쓰기 셋은 자리·사업자번호 claim·변경 기록을 한 transaction에서 고친다. 하나라도 거절되면 셋 다 남지 않는다 — 자리는 생겼는데
 * 번호가 안 묶이면 한 업체가 두 이름으로 같은 공고에서 부딪히는 틈이 생긴다(ADR 0071 결정 6).
 *
 * 겹침 판정은 저장소가 먼저 묻지 않고 DB exclusion 제약에 맡긴다. 먼저 물으면 묻고 쓰는 사이에 다른 운영자가 끼어든다.
 */
export interface MarketSeatAdminStore {
  /** 지금 쓰는 자리와 `endedSince` 뒤에 끝난 자리다. */
  listSeats(input: { readonly endedSince: Temporal.Instant }): Promise<readonly MarketSeatRecord[]>;
  listWorkspaces(): Promise<readonly OperatorWorkspaceRecord[]>;
  /** 업체가 없으면 `null`이다. */
  grant(input: {
    readonly workspaceId: bigint;
    readonly regionCodeValueId: bigint;
    readonly item: MarketSeatItemRecord;
    readonly startsAt: Temporal.Instant;
    readonly endsAt: Temporal.Instant;
    readonly note: MarketSeatChangeNote;
  }): Promise<MarketSeatCommandOutcome | null>;
  /** 자리가 없으면 `null`이다. 끝은 저장소가 잠근 지금 값에서 계산한다. */
  extend(input: { readonly marketSeatId: bigint; readonly months: number; readonly note: MarketSeatChangeNote }): Promise<MarketSeatCommandOutcome | null>;
  revoke(input: { readonly marketSeatId: bigint; readonly note: MarketSeatChangeNote }): Promise<MarketSeatCommandOutcome | null>;
}

export class MarketSeatAdminUnavailable extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE" as const;

  constructor(cause: unknown) {
    super("Market seat administration store is unavailable", { cause });
    this.name = "MarketSeatAdminUnavailable";
  }
}

export class MarketSeatTargetNotFound extends Error {
  readonly code = "NOT_FOUND" as const;

  constructor(readonly target: "workspace" | "market-seat") {
    super(`Market seat command target not found: ${target}`);
    this.name = "MarketSeatTargetNotFound";
  }
}
