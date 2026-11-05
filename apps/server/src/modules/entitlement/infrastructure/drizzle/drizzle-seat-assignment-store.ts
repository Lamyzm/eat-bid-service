/**
 * @module 책임: 공고 배정 port를 PostgreSQL로 구현한다 — 최신 개정본의 (참가제한지역, 품목 칸) 짝에 걸친 자리를 읽고, 배정 이력을
 * 부분 unique에 기대어 한 곳만 쓰게 한다.
 */
import { sql, type SQL } from "drizzle-orm";
import { Temporal } from "@eatbid/domain";

import { bigintArrayLiteral } from "../../../../platform/database/sql-values";
import { latestRevisionOrder } from "../../../../platform/database/latest-revision-order";
import type { AssignmentKind, CoveringSeat, CurrentAssignment, MarketSeatState } from "../../domain/seat-assignment";
import type { AssignmentBasis, SeatAssignmentStore, TakeAssignmentInput } from "../../application/seat-assignment-store";

export interface SeatAssignmentDatabase {
  execute(query: SQL): Promise<unknown>;
  transaction<A>(work: (transaction: SeatAssignmentDatabase) => Promise<A>): Promise<A>;
}

/**
 * 품목 제한이 없는 공고의 품목 칸이다. eaT `MN_TRMT_LMT_YN`의 `N`이며, 자리는 이 code value를 "품목 제한 없음"
 * 품목으로 가리킨다(ADR 0072). 코드는 원천 값 그대로이고 우리가 붙인 이름이 아니다. `Y`는 자리가 되지 않는다 —
 * `Y`인 공고는 품목 원자가 있고 그 원자 자리가 받는다.
 */
const MAIN_ITEM_RESTRICTION_SCHEME = "eat:main-item-restriction";
const NO_MAIN_ITEM_RESTRICTION_CODE = "N";

// 시각은 UTC canonical 텍스트로 좁혀 받는다. driver 시간 표현을 이름으로 부를 수 있는 파일은 정해져 있다(AGENTS 17).
const UTC_INSTANT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

function rows<Row>(result: unknown): Row[] {
  return Array.isArray(result) ? result as Row[] : [];
}

function instantOf(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

const SEAT_STATES: readonly MarketSeatState[] = ["held", "active", "reclaim", "offer"];
const ASSIGNMENT_KINDS: readonly AssignmentKind[] = ["took", "handed_over", "confirmed", "corrected"];

function seatState(value: string): MarketSeatState {
  const state = SEAT_STATES.find((known) => known === value);
  if (state === undefined) throw new TypeError(`Unknown market seat state: ${value}`);
  return state;
}

function assignmentKind(value: string): AssignmentKind {
  const kind = ASSIGNMENT_KINDS.find((known) => known === value);
  if (kind === undefined) throw new TypeError(`Unknown assignment kind: ${value}`);
  return kind;
}

interface BasisRow {
  readonly basis_observation_id: string;
  readonly deadline_at: string | null;
  readonly has_item: boolean;
  /** bigint를 JSON 숫자로 내보내면 2^53을 넘는 번호가 조용히 바뀌므로 번호는 모두 문자열로 싣는다. */
  readonly seats: ReadonlyArray<{
    readonly market_seat_id: string;
    readonly workspace_id: string;
    readonly state: string;
    readonly starts_at: string;
    readonly ends_at: string;
    readonly priority_started_at: string;
  }>;
}

interface CurrentRow {
  readonly assignment_id: string;
  readonly workspace_id: string;
  readonly market_seat_id: string;
  readonly kind: string;
}

function utc(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'UTC', ${UTC_INSTANT_FORMAT})`;
}

function insertAssignment(input: TakeAssignmentInput, kind: "took" | "handed_over"): SQL {
  return sql`
    insert into app.auction_amount_assignment
      (auction_attempt_id, workspace_id, market_seat_id, kind, basis_observation_id, rule_version,
       candidate_market_seat_ids, recorded_at)
    values (
      ${input.auctionAttemptId}::bigint, ${input.seat.workspaceId}::bigint, ${input.seat.marketSeatId}::bigint, ${kind},
      ${input.basisObservationId}::bigint, ${input.ruleVersion},
      ${bigintArrayLiteral(input.candidates.map((seat) => seat.marketSeatId))}::bigint[], ${input.recordedAt.toString()}::timestamptz
    )
    on conflict (auction_attempt_id) where superseded_at is null do nothing
  `;
}

function closeCurrent(from: CurrentAssignment, at: Temporal.Instant): SQL {
  return sql`
    update app.auction_amount_assignment
       set superseded_at = ${at.toString()}::timestamptz
     where auction_amount_assignment_id = ${from.assignmentId}::bigint
       and superseded_at is null
    returning auction_amount_assignment_id
  `;
}

export class DrizzleSeatAssignmentStore implements SeatAssignmentStore {
  constructor(private readonly database: SeatAssignmentDatabase) {}

  async readBasis(input: { readonly auctionAttemptId: bigint; readonly at: Temporal.Instant }): Promise<AssignmentBasis | null> {
    const at = input.at.toString();
    // 걸침은 공고의 (지역, 품목 칸) 모든 짝 가운데 하나라도 자리와 같은 것이다. 지역은 코드가 정확히 같아야 하고 넓히지 않는다.
    // 품목 칸은 품목 원자들과, 품목 제한이 `N`이면 그 code value 하나다(ADR 0072). 둘 다 없으면 eat-v6 전 해석이라 품목 칸을
    // 모르는 것이고, 지역만으로 넓히지 않는다(ADR 0071 기각안).
    // 기간이 `at`을 포함하는 자리만 싣지만 상태는 거르지 않는다 — 상태 판정은 도메인 규칙 하나가 한다.
    const result = await this.database.execute(sql`
      with latest as (
        select revision.auction_revision_id, revision.observation_id, revision.deadline_at
          from core.auction_revision revision
         where revision.auction_attempt_id = ${input.auctionAttemptId}::bigint
         order by ${latestRevisionOrder("revision")}
         limit 1
      ),
      market_items as (
        select item.code_value_id
          from latest
          join core.auction_revision_code_value item
            on item.auction_revision_id = latest.auction_revision_id and item.role = 'item'
        union
        select restriction.code_value_id
          from latest
          join core.auction_revision_code_value restriction
            on restriction.auction_revision_id = latest.auction_revision_id and restriction.role = 'main_item_restriction'
          join core.code_value value
            on value.code_value_id = restriction.code_value_id and value.code = ${NO_MAIN_ITEM_RESTRICTION_CODE}
          join core.code_scheme scheme
            on scheme.code_scheme_id = value.code_scheme_id and scheme.namespace = ${MAIN_ITEM_RESTRICTION_SCHEME}
      ),
      pairs as (
        select area.code_value_id as region_code_value_id, market_items.code_value_id as item_code_value_id
          from latest
          join core.auction_revision_code_value area
            on area.auction_revision_id = latest.auction_revision_id and area.role = 'eligibility_area'
          cross join market_items
      )
      select
        latest.observation_id::text as basis_observation_id,
        ${utc(sql`latest.deadline_at`)} as deadline_at,
        exists (select 1 from market_items) as has_item,
        coalesce((
          select json_agg(json_build_object(
                   'market_seat_id', seat.market_seat_id::text,
                   'workspace_id', seat.workspace_id::text,
                   'state', seat.state,
                   'starts_at', ${utc(sql`seat.starts_at`)},
                   'ends_at', ${utc(sql`seat.ends_at`)},
                   'priority_started_at', ${utc(sql`seat.priority_started_at`)}
                 ) order by seat.market_seat_id)
            from app.market_seat seat
           where (seat.region_code_value_id, seat.item_code_value_id) in (select region_code_value_id, item_code_value_id from pairs)
             and seat.starts_at <= ${at}::timestamptz
             and seat.ends_at > ${at}::timestamptz
        ), '[]'::json) as seats
      from latest
    `);
    const [row] = rows<BasisRow>(result);
    if (row === undefined) return null;
    const coveringSeats: CoveringSeat[] = row.seats.map((seat) => ({
      marketSeatId: BigInt(seat.market_seat_id),
      workspaceId: BigInt(seat.workspace_id),
      state: seatState(seat.state),
      startsAt: instantOf(seat.starts_at),
      endsAt: instantOf(seat.ends_at),
      priorityStartedAt: instantOf(seat.priority_started_at),
    }));
    return {
      basisObservationId: BigInt(row.basis_observation_id),
      situation: {
        at: input.at,
        hasItem: row.has_item,
        deadlineAt: row.deadline_at === null ? null : instantOf(row.deadline_at),
        coveringSeats,
        current: await this.readCurrent(input.auctionAttemptId),
      },
    };
  }

  async readCurrent(auctionAttemptId: bigint): Promise<CurrentAssignment | null> {
    const result = await this.database.execute(sql`
      select auction_amount_assignment_id::text as assignment_id, workspace_id::text as workspace_id,
             market_seat_id::text as market_seat_id, kind
        from app.auction_amount_assignment
       where auction_attempt_id = ${auctionAttemptId}::bigint and superseded_at is null
    `);
    const [row] = rows<CurrentRow>(result);
    if (row === undefined) return null;
    return {
      assignmentId: BigInt(row.assignment_id),
      workspaceId: BigInt(row.workspace_id),
      marketSeatId: BigInt(row.market_seat_id),
      kind: assignmentKind(row.kind),
    };
  }

  async take(input: TakeAssignmentInput): Promise<void> {
    await this.database.execute(insertAssignment(input, "took"));
  }

  async handOver(input: TakeAssignmentInput & { readonly from: CurrentAssignment }): Promise<void> {
    // 닫기에 진 쪽(다른 요청이 먼저 닫았다)은 새 줄을 더하지 않는다. 이긴 쪽의 판정이 지금 줄이 된다.
    await this.database.transaction(async (transaction) => {
      const closed = rows(await transaction.execute(closeCurrent(input.from, input.recordedAt)));
      if (closed.length === 0) return;
      await transaction.execute(insertAssignment(input, "handed_over"));
    });
  }

  async vacate(input: { readonly from: CurrentAssignment; readonly at: Temporal.Instant }): Promise<void> {
    await this.database.execute(closeCurrent(input.from, input.at));
  }
}
