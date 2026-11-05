/**
 * @module 책임: 운영자 시장 자리 port를 PostgreSQL로 구현한다 — 자리·사업자번호 claim·변경 기록을 한 transaction에서 고치고,
 * exclusion 제약 위반을 "누가 언제까지 쓰는지"가 담긴 거절로 바꾼다.
 */
import { sql } from "drizzle-orm";
import { CODE_SCHEME_NAMES } from "@eatbid/contracts";
import type { Temporal } from "@eatbid/domain";

import { extendedEnd, hasEnded, revokedEnd } from "../../domain/seat-period";
import type {
  MarketSeatAdminStore,
  MarketSeatChangeNote,
  MarketSeatCommandOutcome,
  MarketSeatEventKindRecord,
  MarketSeatItemRecord,
  MarketSeatRecord,
  MarketSeatRejectionRecord,
  OperatorWorkspaceRecord,
} from "../../application/market-seat-admin-store";
import type { SeatAssignmentDatabase } from "./drizzle-seat-assignment-store";
import {
  MAIN_ITEM_RESTRICTION_SCHEME,
  NO_MAIN_ITEM_RESTRICTION_CODE,
  businessNumbersOf,
  instantOf,
  rows,
  seatQuery,
  seatRecord,
  utc,
  type SeatRow,
  type WorkspaceRow,
} from "./market-seat-admin-sql";

const EXCLUSION_VIOLATION = "23P01";
const SEAT_OVERLAP_CONSTRAINT = "market_seat_no_overlap";
const CLAIM_CONSTRAINT = "seat_business_claim_one_workspace";

/**
 * Drizzle은 driver 오류를 감싸므로 원인 사슬을 따라가 제약 이름을 찾는다. exclusion 위반만 거절로 바꾸고 나머지는 그대로 던진다 —
 * 다른 실패를 "겹침"으로 말하면 운영자가 엉뚱한 업체에 전화한다.
 */
function violatedExclusion(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const candidate = current as { code?: unknown; constraint_name?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === EXCLUSION_VIOLATION) {
      const name = candidate.constraint_name ?? candidate.constraint;
      return typeof name === "string" ? name : null;
    }
    current = candidate.cause;
  }
  return null;
}

/** transaction 안에서 거절을 만나면 이 값을 던져 쓰기 전부를 되돌린다. 바깥에서 결과로 바꾼다. */
class RejectedInTransaction extends Error {
  constructor(readonly rejection: MarketSeatRejectionRecord) {
    super(`market seat command rejected: ${rejection.reason}`);
  }
}

/** exclusion 위반으로 transaction이 깨졌다. 깨진 transaction 안에서는 더 물을 수 없어 바깥에서 겹친 상대를 찾는다. */
class ExclusionInTransaction extends Error {
  constructor(readonly constraint: string, readonly context: { readonly marketSeatId: bigint | null; readonly regionCodeValueId: bigint; readonly itemCodeValueId: bigint; readonly workspaceId: bigint; readonly startsAt: Temporal.Instant; readonly endsAt: Temporal.Instant }) {
    super(`market seat exclusion violated: ${constraint}`);
  }
}

interface LockedSeatRow {
  readonly workspace_id: string;
  readonly region_code_value_id: string;
  readonly item_code_value_id: string;
  readonly starts_at: string;
  readonly ends_at: string;
}

export class DrizzleMarketSeatAdminStore implements MarketSeatAdminStore {
  constructor(private readonly database: SeatAssignmentDatabase) {}

  async listSeats(input: { readonly endedSince: Temporal.Instant }): Promise<readonly MarketSeatRecord[]> {
    const result = await this.database.execute(seatQuery(sql`seat.ends_at > ${input.endedSince.toString()}::timestamptz`));
    return rows<SeatRow>(result).map(seatRecord);
  }

  async listWorkspaces(): Promise<readonly OperatorWorkspaceRecord[]> {
    const result = await this.database.execute(sql`
      select workspace.workspace_id::text as workspace_id, workspace.name,
             ${businessNumbersOf(sql`workspace.workspace_id`)} as business_numbers
        from app.workspace workspace
       order by workspace.workspace_id
    `);
    return rows<WorkspaceRow>(result).map((row) => ({
      workspaceId: BigInt(row.workspace_id),
      name: row.name,
      businessNumbers: row.business_numbers,
    }));
  }

  async grant(input: Parameters<MarketSeatAdminStore["grant"]>[0]): Promise<MarketSeatCommandOutcome | null> {
    return this.command(async (transaction) => {
      const [workspace] = rows<{ readonly found: number }>(await transaction.execute(sql`
        select 1 as found from app.workspace where workspace_id = ${input.workspaceId}::bigint
      `));
      if (workspace === undefined) return null;
      const [region] = rows<{ readonly found: number }>(await transaction.execute(sql`
        select 1 as found
          from core.code_value value
          join core.code_scheme scheme on scheme.code_scheme_id = value.code_scheme_id
         where value.code_value_id = ${input.regionCodeValueId}::bigint and scheme.namespace = ${CODE_SCHEME_NAMES.eligibilityArea}
      `));
      if (region === undefined) throw new RejectedInTransaction({ reason: "region-not-eligibility-area" });
      const itemCodeValueId = await this.itemCodeValueId(transaction, input.item);
      if (itemCodeValueId === null) throw new RejectedInTransaction({ reason: "item-not-observed" });
      const numbers = await this.businessNumbers(transaction, input.workspaceId);
      if (numbers.length === 0) throw new RejectedInTransaction({ reason: "no-registered-business" });

      const context = {
        marketSeatId: null,
        regionCodeValueId: input.regionCodeValueId,
        itemCodeValueId,
        workspaceId: input.workspaceId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      };
      const [seat] = rows<{ readonly market_seat_id: string }>(await this.guarded(context, () => transaction.execute(sql`
        insert into app.market_seat
          (workspace_id, region_code_value_id, item_code_value_id, state, starts_at, ends_at, priority_started_at)
        values (${input.workspaceId}::bigint, ${input.regionCodeValueId}::bigint, ${itemCodeValueId}::bigint, 'active',
                ${input.startsAt.toString()}::timestamptz, ${input.endsAt.toString()}::timestamptz, ${input.startsAt.toString()}::timestamptz)
        returning market_seat_id::text as market_seat_id
      `)));
      const marketSeatId = BigInt(seat!.market_seat_id);
      await this.claim(transaction, { ...context, marketSeatId }, numbers, input.startsAt, input.endsAt);
      await this.record(transaction, marketSeatId, "activated", input.note, null, input.endsAt);
      return marketSeatId;
    });
  }

  async extend(input: Parameters<MarketSeatAdminStore["extend"]>[0]): Promise<MarketSeatCommandOutcome | null> {
    return this.command(async (transaction) => {
      const locked = await this.lock(transaction, input.marketSeatId);
      if (locked === null) return null;
      const endsAt = instantOf(locked.ends_at);
      if (hasEnded({ endsAt, now: input.note.at })) throw new RejectedInTransaction({ reason: "seat-ended" });
      const nextEndsAt = extendedEnd({ endsAt, months: input.months });
      const workspaceId = BigInt(locked.workspace_id);
      const numbers = await this.businessNumbers(transaction, workspaceId);
      if (numbers.length === 0) throw new RejectedInTransaction({ reason: "no-registered-business" });
      const context = {
        marketSeatId: input.marketSeatId,
        regionCodeValueId: BigInt(locked.region_code_value_id),
        itemCodeValueId: BigInt(locked.item_code_value_id),
        workspaceId,
        startsAt: endsAt,
        endsAt: nextEndsAt,
      };
      await this.guarded(context, () => transaction.execute(sql`
        update app.market_seat set ends_at = ${nextEndsAt.toString()}::timestamptz
         where market_seat_id = ${input.marketSeatId}::bigint
      `));
      // 늘린 구간만큼 번호를 더 묶는다. 같은 워크스페이스의 claim끼리는 겹쳐도 되므로 기존 줄을 고치지 않고 더한다.
      await this.claim(transaction, context, numbers, endsAt, nextEndsAt);
      await this.record(transaction, input.marketSeatId, "extended", input.note, endsAt, nextEndsAt);
      return input.marketSeatId;
    });
  }

  async revoke(input: Parameters<MarketSeatAdminStore["revoke"]>[0]): Promise<MarketSeatCommandOutcome | null> {
    return this.command(async (transaction) => {
      const locked = await this.lock(transaction, input.marketSeatId);
      if (locked === null) return null;
      const endsAt = instantOf(locked.ends_at);
      const now = input.note.at;
      if (hasEnded({ endsAt, now })) throw new RejectedInTransaction({ reason: "seat-ended" });
      const nextEndsAt = revokedEnd({ startsAt: instantOf(locked.starts_at), now });
      await transaction.execute(sql`
        update app.market_seat set ends_at = ${nextEndsAt.toString()}::timestamptz
         where market_seat_id = ${input.marketSeatId}::bigint
      `);
      // 이 워크스페이스의 다른 자리가 아직 살아 있으면 그 끝까지는 번호를 계속 묶는다. 다 끝났으면 지금에서 푼다.
      // 남는 틈(뒤 자리 시작 전까지)을 묶어 두는 쪽은 다른 업체를 막을 뿐 이 업체에 금액을 더 주지 않으므로 안전한 쪽이다.
      await transaction.execute(sql`
        with remaining as (
          select greatest(${now.toString()}::timestamptz, coalesce(max(other.ends_at), ${now.toString()}::timestamptz)) as until
            from app.market_seat other
           where other.workspace_id = ${locked.workspace_id}::bigint
             and other.market_seat_id <> ${input.marketSeatId}::bigint
             and other.ends_at > ${now.toString()}::timestamptz
        )
        update app.seat_business_claim claim
           set ends_at = greatest(claim.starts_at, remaining.until)
          from remaining
         where claim.workspace_id = ${locked.workspace_id}::bigint
           and claim.ends_at > remaining.until
      `);
      await this.record(transaction, input.marketSeatId, "revoked", input.note, endsAt, nextEndsAt);
      return input.marketSeatId;
    });
  }

  /**
   * 쓰기 하나를 transaction으로 돌리고 끝난 자리를 다시 읽어 답한다. 거절은 transaction을 되돌린 뒤 결과로 바꾼다.
   * exclusion 위반은 transaction이 이미 깨졌으므로 바깥에서 겹친 상대를 읽는다.
   */
  private async command(work: (transaction: SeatAssignmentDatabase) => Promise<bigint | null>): Promise<MarketSeatCommandOutcome | null> {
    let marketSeatId: bigint | null;
    try {
      marketSeatId = await this.database.transaction(work);
    } catch (error) {
      if (error instanceof RejectedInTransaction) return { kind: "rejected", rejection: error.rejection };
      if (error instanceof ExclusionInTransaction) return { kind: "rejected", rejection: await this.explain(error) };
      throw error;
    }
    if (marketSeatId === null) return null;
    const [row] = rows<SeatRow>(await this.database.execute(seatQuery(sql`seat.market_seat_id = ${marketSeatId}::bigint`)));
    if (row === undefined) throw new Error("Saved market seat disappeared before it was read back");
    return { kind: "saved", seat: seatRecord(row) };
  }

  private async guarded(context: ExclusionInTransaction["context"], write: () => Promise<unknown>): Promise<unknown> {
    try {
      return await write();
    } catch (error) {
      const constraint = violatedExclusion(error);
      if (constraint === SEAT_OVERLAP_CONSTRAINT || constraint === CLAIM_CONSTRAINT) throw new ExclusionInTransaction(constraint, context);
      throw error;
    }
  }

  private async explain(error: ExclusionInTransaction): Promise<MarketSeatRejectionRecord> {
    const { context } = error;
    const period = sql`tstzrange(${context.startsAt.toString()}::timestamptz, ${context.endsAt.toString()}::timestamptz)`;
    if (error.constraint === SEAT_OVERLAP_CONSTRAINT) {
      const [holder] = rows<{ readonly workspace_id: string; readonly name: string; readonly ends_at: string }>(await this.database.execute(sql`
        select workspace.workspace_id::text as workspace_id, workspace.name, ${utc(sql`seat.ends_at`)} as ends_at
          from app.market_seat seat
          join app.workspace workspace on workspace.workspace_id = seat.workspace_id
         where seat.region_code_value_id = ${context.regionCodeValueId}::bigint
           and seat.item_code_value_id = ${context.itemCodeValueId}::bigint
           and tstzrange(seat.starts_at, seat.ends_at) && ${period}
           and seat.market_seat_id is distinct from ${context.marketSeatId}::bigint
         order by seat.ends_at desc
         limit 1
      `));
      if (holder === undefined) throw new Error("Market seat overlap was reported but no overlapping seat was found", { cause: error });
      return {
        reason: "period-overlap",
        holder: { workspaceId: BigInt(holder.workspace_id), name: holder.name },
        holderEndsAt: instantOf(holder.ends_at),
      };
    }
    const [holder] = rows<{ readonly workspace_id: string; readonly name: string; readonly business_number: string }>(await this.database.execute(sql`
      select workspace.workspace_id::text as workspace_id, workspace.name, claim.business_number::text as business_number
        from app.seat_business_claim claim
        join app.workspace workspace on workspace.workspace_id = claim.workspace_id
       where claim.business_number = any(${businessNumbersOf(sql`${context.workspaceId}::bigint`)})
         and claim.workspace_id <> ${context.workspaceId}::bigint
         and tstzrange(claim.starts_at, claim.ends_at) && ${period}
       order by claim.ends_at desc
       limit 1
    `));
    if (holder === undefined) throw new Error("Business claim conflict was reported but no other claim was found", { cause: error });
    return {
      reason: "business-claimed-elsewhere",
      businessNumber: holder.business_number,
      holder: { workspaceId: BigInt(holder.workspace_id), name: holder.name },
    };
  }

  private async itemCodeValueId(transaction: SeatAssignmentDatabase, item: MarketSeatItemRecord): Promise<bigint | null> {
    const [namespace, code] = item.kind === "atom"
      ? [CODE_SCHEME_NAMES.auctionItem, item.atom]
      : [MAIN_ITEM_RESTRICTION_SCHEME, NO_MAIN_ITEM_RESTRICTION_CODE];
    const [row] = rows<{ readonly code_value_id: string }>(await transaction.execute(sql`
      select value.code_value_id::text as code_value_id
        from core.code_value value
        join core.code_scheme scheme on scheme.code_scheme_id = value.code_scheme_id
       where scheme.namespace = ${namespace} and value.code = ${code}
    `));
    return row === undefined ? null : BigInt(row.code_value_id);
  }

  private async businessNumbers(transaction: SeatAssignmentDatabase, workspaceId: bigint): Promise<readonly string[]> {
    const [row] = rows<{ readonly numbers: readonly string[] }>(await transaction.execute(sql`
      select ${businessNumbersOf(sql`${workspaceId}::bigint`)} as numbers
    `));
    return row?.numbers ?? [];
  }

  private async lock(transaction: SeatAssignmentDatabase, marketSeatId: bigint): Promise<LockedSeatRow | null> {
    const [row] = rows<LockedSeatRow>(await transaction.execute(sql`
      select workspace_id::text as workspace_id, region_code_value_id::text as region_code_value_id,
             item_code_value_id::text as item_code_value_id,
             ${utc(sql`starts_at`)} as starts_at, ${utc(sql`ends_at`)} as ends_at
        from app.market_seat
       where market_seat_id = ${marketSeatId}::bigint
       for update
    `));
    return row ?? null;
  }

  private async claim(
    transaction: SeatAssignmentDatabase,
    context: ExclusionInTransaction["context"],
    numbers: readonly string[],
    startsAt: Temporal.Instant,
    endsAt: Temporal.Instant,
  ): Promise<void> {
    for (const number of numbers) {
      await this.guarded(context, () => transaction.execute(sql`
        insert into app.seat_business_claim (workspace_id, business_number, starts_at, ends_at)
        values (${context.workspaceId}::bigint, ${number}, ${startsAt.toString()}::timestamptz, ${endsAt.toString()}::timestamptz)
      `));
    }
  }

  private async record(
    transaction: SeatAssignmentDatabase,
    marketSeatId: bigint,
    kind: MarketSeatEventKindRecord,
    note: MarketSeatChangeNote,
    previousEndsAt: Temporal.Instant | null,
    nextEndsAt: Temporal.Instant | null,
  ): Promise<void> {
    await transaction.execute(sql`
      insert into app.market_seat_event
        (market_seat_id, kind, occurred_at, actor_principal_id, reason_code, memo, previous_ends_at, next_ends_at)
      values (${marketSeatId}::bigint, ${kind}, ${note.at.toString()}::timestamptz, ${note.actorPrincipalId}::bigint,
              ${note.reason}, ${note.memo}, ${previousEndsAt?.toString() ?? null}::timestamptz, ${nextEndsAt?.toString() ?? null}::timestamptz)
    `);
  }
}
