/**
 * @module 책임: 운영자가 시장 자리를 조회·부여·연장·회수하는 use case를 소유한다(ADR 0071 결정 1·6·7, ADR 0072).
 *
 * 넷을 한 모듈에 두는 이유는 같은 이유로 바뀌기 때문이다. 사유·메모 규칙, 기록할 행위자, 시각을 정하는 시계가 바뀌면 네 경로가 함께
 * 바뀐다. 인가(운영자인가)는 controller의 guard가 진다.
 */
import { Effect } from "effect";
import type { Clock, Temporal } from "@eatbid/domain";

import { grantPeriod } from "../domain/seat-period";
import {
  MarketSeatAdminUnavailable,
  MarketSeatTargetNotFound,
  type MarketSeatAdminStore,
  type MarketSeatChangeNote,
  type MarketSeatCommandOutcome,
  type MarketSeatItemRecord,
  type MarketSeatReasonRecord,
  type MarketSeatRecord,
  type OperatorWorkspaceRecord,
} from "./market-seat-admin-store";

/** 끝난 자리를 목록에 남겨 두는 기간이다. 회수 직후 "방금 거둔 자리"를 운영자가 확인할 수 있어야 한다. */
const ENDED_SEAT_RETENTION_DAYS = 30;

interface ChangeRequest {
  readonly actorPrincipalId: bigint;
  readonly reason: MarketSeatReasonRecord;
  readonly memo: string | null;
}

function store<A>(work: () => Promise<A>): Effect.Effect<A, MarketSeatAdminUnavailable> {
  return Effect.tryPromise({ try: work, catch: (cause) => new MarketSeatAdminUnavailable(cause) });
}

function found(
  target: "workspace" | "market-seat",
): (outcome: MarketSeatCommandOutcome | null) => Effect.Effect<MarketSeatCommandOutcome, MarketSeatTargetNotFound> {
  return (outcome) => outcome === null ? Effect.fail(new MarketSeatTargetNotFound(target)) : Effect.succeed(outcome);
}

export class AdministerMarketSeats {
  constructor(
    private readonly seats: MarketSeatAdminStore,
    private readonly clock: Clock,
  ) {}

  listSeats(): Effect.Effect<{ readonly seats: readonly MarketSeatRecord[]; readonly asOf: Temporal.Instant }, MarketSeatAdminUnavailable> {
    const asOf = this.clock.now();
    const endedSince = asOf.subtract({ hours: ENDED_SEAT_RETENTION_DAYS * 24 });
    return store(() => this.seats.listSeats({ endedSince })).pipe(Effect.map((seats) => ({ seats, asOf })));
  }

  listWorkspaces(): Effect.Effect<readonly OperatorWorkspaceRecord[], MarketSeatAdminUnavailable> {
    return store(() => this.seats.listWorkspaces());
  }

  grant(input: ChangeRequest & {
    readonly workspaceId: bigint;
    readonly regionCodeValueId: bigint;
    readonly item: MarketSeatItemRecord;
    readonly startDate: Temporal.PlainDate;
    readonly months: number;
  }): Effect.Effect<MarketSeatCommandOutcome, MarketSeatAdminUnavailable | MarketSeatTargetNotFound> {
    const note = this.note(input);
    if (note === null) return Effect.succeed(rejected("memo-required"));
    const period = grantPeriod({ startDate: input.startDate, months: input.months, now: note.at });
    if (period.kind === "start-in-past") return Effect.succeed(rejected("start-in-past"));
    return store(() => this.seats.grant({
      workspaceId: input.workspaceId,
      regionCodeValueId: input.regionCodeValueId,
      item: input.item,
      startsAt: period.startsAt,
      endsAt: period.endsAt,
      note,
    })).pipe(Effect.flatMap(found("workspace")));
  }

  extend(input: ChangeRequest & { readonly marketSeatId: bigint; readonly months: number }): Effect.Effect<
    MarketSeatCommandOutcome,
    MarketSeatAdminUnavailable | MarketSeatTargetNotFound
  > {
    const note = this.note(input);
    if (note === null) return Effect.succeed(rejected("memo-required"));
    return store(() => this.seats.extend({ marketSeatId: input.marketSeatId, months: input.months, note }))
      .pipe(Effect.flatMap(found("market-seat")));
  }

  revoke(input: ChangeRequest & { readonly marketSeatId: bigint }): Effect.Effect<
    MarketSeatCommandOutcome,
    MarketSeatAdminUnavailable | MarketSeatTargetNotFound
  > {
    const note = this.note(input);
    if (note === null) return Effect.succeed(rejected("memo-required"));
    return store(() => this.seats.revoke({ marketSeatId: input.marketSeatId, note }))
      .pipe(Effect.flatMap(found("market-seat")));
  }

  /** "기타"는 무엇을 했는지 고정 목록이 말하지 못하므로 메모가 있어야 한다. 분쟁과 환불 판단의 1차 자료다. */
  private note(input: ChangeRequest): MarketSeatChangeNote | null {
    if (input.reason === "other" && input.memo === null) return null;
    return { actorPrincipalId: input.actorPrincipalId, reason: input.reason, memo: input.memo, at: this.clock.now() };
  }
}

function rejected(reason: "memo-required" | "start-in-past"): MarketSeatCommandOutcome {
  return { kind: "rejected", rejection: { reason } };
}
