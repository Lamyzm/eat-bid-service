/** @module 책임: 운영자 시장 자리 record·거절을 v1 공개 응답 표현으로 옮긴다 — bigint와 시각을 손실 없는 텍스트로 바꾼다. */
import type {
  MarketSeatCommandResult,
  MarketSeatRejection,
  OperatorMarketSeat,
  OperatorMarketSeatsV1Response,
  OperatorWorkspace,
  OperatorWorkspacesV1Response,
} from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";

import { bigintText, instantText } from "../../../../platform/http/wire";
import type {
  MarketSeatCommandOutcome,
  MarketSeatRecord,
  MarketSeatRejectionRecord,
  OperatorWorkspaceRecord,
} from "../../application/market-seat-admin-store";

function workspace(record: OperatorWorkspaceRecord): OperatorWorkspace {
  return { workspaceId: bigintText(record.workspaceId), name: record.name, businessNumbers: [...record.businessNumbers] };
}

function seat(record: MarketSeatRecord): OperatorMarketSeat {
  return {
    marketSeatId: bigintText(record.marketSeatId),
    workspace: workspace(record.workspace),
    region: {
      codeValueId: bigintText(record.region.codeValueId),
      code: record.region.code,
      scheme: record.region.scheme,
      label: record.region.label,
    },
    item: record.item.kind === "atom" ? { kind: "atom", atom: record.item.atom } : { kind: "no-main-item-restriction" },
    state: record.state,
    startsAt: instantText(record.startsAt),
    endsAt: instantText(record.endsAt),
    priorityStartedAt: instantText(record.priorityStartedAt),
    events: record.events.map((event) => ({
      kind: event.kind,
      occurredAt: instantText(event.occurredAt),
      reason: event.reason,
      memo: event.memo,
      actorPrincipalId: bigintText(event.actorPrincipalId),
      previousEndsAt: instantText(event.previousEndsAt),
      nextEndsAt: instantText(event.nextEndsAt),
    })),
  };
}

function rejection(record: MarketSeatRejectionRecord): MarketSeatRejection {
  switch (record.reason) {
    case "period-overlap":
      return {
        reason: record.reason,
        holder: { workspaceId: bigintText(record.holder.workspaceId), name: record.holder.name },
        holderEndsAt: instantText(record.holderEndsAt),
      };
    case "business-claimed-elsewhere":
      return {
        reason: record.reason,
        businessNumber: record.businessNumber,
        holder: { workspaceId: bigintText(record.holder.workspaceId), name: record.holder.name },
      };
    default:
      return { reason: record.reason };
  }
}

export function toOperatorMarketSeatsResponse(input: {
  readonly seats: readonly MarketSeatRecord[];
  readonly asOf: Temporal.Instant;
}): OperatorMarketSeatsV1Response {
  return { seats: input.seats.map(seat), asOf: instantText(input.asOf) };
}

export function toOperatorWorkspacesResponse(records: readonly OperatorWorkspaceRecord[]): OperatorWorkspacesV1Response {
  return { workspaces: records.map(workspace) };
}

export function toMarketSeatCommandResult(outcome: MarketSeatCommandOutcome): MarketSeatCommandResult {
  return outcome.kind === "saved"
    ? { kind: "saved", seat: seat(outcome.seat) }
    : { kind: "rejected", rejection: rejection(outcome.rejection) };
}
