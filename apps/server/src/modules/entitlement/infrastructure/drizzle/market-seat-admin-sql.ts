/**
 * @module 책임: 운영자 시장 자리를 읽는 SQL과 그 행을 내부 record로 옮기는 규칙을 소유한다 — 품목 칸이 어느 체계의 값인지
 * 판정하고, 다른 체계의 값이 앉아 있으면 결함으로 드러낸다.
 */
import { sql, type SQL } from "drizzle-orm";
import { AUCTION_ITEM_ATOMS, CODE_SCHEME_NAMES, type AuctionItemAtom } from "@eatbid/contracts";
import { Temporal } from "@eatbid/domain";

import type { MarketSeatState } from "../../domain/seat-assignment";
import type {
  MarketSeatEventKindRecord,
  MarketSeatItemRecord,
  MarketSeatReasonRecord,
  MarketSeatRecord,
} from "../../application/market-seat-admin-store";

// 시각은 UTC canonical 텍스트로 좁혀 받는다. driver 시간 표현을 이름으로 부를 수 있는 파일은 정해져 있다(AGENTS 17).
const UTC_INSTANT_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
// "품목 제한 없음"은 eaT `MN_TRMT_LMT_YN`의 `N`이다(ADR 0072). 배정 저장소와 같은 원천 코드다.
export const MAIN_ITEM_RESTRICTION_SCHEME = "eat:main-item-restriction";
export const NO_MAIN_ITEM_RESTRICTION_CODE = "N";

export function rows<Row>(result: unknown): Row[] {
  return Array.isArray(result) ? result as Row[] : [];
}

export function instantOf(value: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw new TypeError("Database timestamp is invalid");
  }
}

function optionalInstant(value: string | null): Temporal.Instant | null {
  return value === null ? null : instantOf(value);
}

export function utc(column: SQL): SQL {
  return sql`to_char(${column} at time zone 'UTC', ${UTC_INSTANT_FORMAT})`;
}

const ATOMS: readonly AuctionItemAtom[] = AUCTION_ITEM_ATOMS;
const SEAT_STATES: readonly MarketSeatState[] = ["held", "active", "reclaim", "offer"];
const REASONS: readonly MarketSeatReasonRecord[] = ["pilot", "payment-confirmed", "operator-correction", "refund-request", "other"];
const EVENT_KINDS: readonly MarketSeatEventKindRecord[] = ["held", "activated", "extended", "revoked", "released", "reclaimed", "offered", "corrected"];

function known<T extends string>(values: readonly T[], value: string, what: string): T {
  const found = values.find((candidate) => candidate === value);
  if (found === undefined) throw new TypeError(`Unknown ${what}: ${value}`);
  return found;
}

function itemOf(scheme: string, code: string): MarketSeatItemRecord {
  if (scheme === CODE_SCHEME_NAMES.auctionItem) return { kind: "atom", atom: known(ATOMS, code, "auction item atom") };
  if (scheme === MAIN_ITEM_RESTRICTION_SCHEME && code === NO_MAIN_ITEM_RESTRICTION_CODE) return { kind: "no-main-item-restriction" };
  // 다른 체계의 값이 품목 칸에 앉아 있으면 데이터 결함이다. 다른 품목으로 읽어 보여 주지 않는다(AGENTS 3).
  throw new TypeError(`Market seat item points outside item schemes: ${scheme}/${code}`);
}

export interface WorkspaceRow {
  readonly workspace_id: string;
  readonly name: string;
  readonly business_numbers: readonly string[];
}

export interface SeatRow extends WorkspaceRow {
  readonly market_seat_id: string;
  readonly region_code_value_id: string;
  readonly region_code: string;
  readonly region_scheme: string;
  readonly region_label: string | null;
  readonly item_scheme: string;
  readonly item_code: string;
  readonly state: string;
  readonly starts_at: string;
  readonly ends_at: string;
  readonly priority_started_at: string;
  readonly events: ReadonlyArray<{
    readonly kind: string;
    readonly occurred_at: string;
    readonly reason_code: string;
    readonly memo: string | null;
    readonly actor_principal_id: string | null;
    readonly previous_ends_at: string | null;
    readonly next_ends_at: string | null;
  }>;
}

export const businessNumbersOf = (workspaceId: SQL): SQL => sql`
  coalesce((
    select array_agg(business.business_number::text order by business.business_number)
      from app.registered_business business
     where business.workspace_id = ${workspaceId} and business.revoked_at is null
  ), '{}'::text[])
`;

export function seatQuery(filter: SQL): SQL {
  return sql`
    select seat.market_seat_id::text as market_seat_id,
           workspace.workspace_id::text as workspace_id,
           workspace.name,
           ${businessNumbersOf(sql`workspace.workspace_id`)} as business_numbers,
           region.code_value_id::text as region_code_value_id,
           region.code as region_code,
           region_scheme.namespace as region_scheme,
           (select observation.label
              from core.code_label_observation observation
             where observation.code_value_id = region.code_value_id
             order by observation.observed_at desc, observation.code_label_observation_id desc
             limit 1) as region_label,
           item_scheme.namespace as item_scheme,
           item.code as item_code,
           seat.state,
           ${utc(sql`seat.starts_at`)} as starts_at,
           ${utc(sql`seat.ends_at`)} as ends_at,
           ${utc(sql`seat.priority_started_at`)} as priority_started_at,
           coalesce((
             select json_agg(json_build_object(
                      'kind', recent.kind,
                      'occurred_at', recent.occurred_at_text,
                      'reason_code', recent.reason_code,
                      'memo', recent.memo,
                      'actor_principal_id', recent.actor_principal_id::text,
                      'previous_ends_at', recent.previous_ends_at_text,
                      'next_ends_at', recent.next_ends_at_text
                    ) order by recent.occurred_at desc, recent.market_seat_event_id desc)
               from (
                 select event.*,
                        ${utc(sql`event.occurred_at`)} as occurred_at_text,
                        ${utc(sql`event.previous_ends_at`)} as previous_ends_at_text,
                        ${utc(sql`event.next_ends_at`)} as next_ends_at_text
                   from app.market_seat_event event
                  where event.market_seat_id = seat.market_seat_id
                  order by event.occurred_at desc, event.market_seat_event_id desc
                  limit 50
               ) recent
           ), '[]'::json) as events
      from app.market_seat seat
      join app.workspace workspace on workspace.workspace_id = seat.workspace_id
      join core.code_value region on region.code_value_id = seat.region_code_value_id
      join core.code_scheme region_scheme on region_scheme.code_scheme_id = region.code_scheme_id
      join core.code_value item on item.code_value_id = seat.item_code_value_id
      join core.code_scheme item_scheme on item_scheme.code_scheme_id = item.code_scheme_id
     where ${filter}
     order by seat.ends_at, seat.market_seat_id
  `;
}

export function seatRecord(row: SeatRow): MarketSeatRecord {
  return {
    marketSeatId: BigInt(row.market_seat_id),
    workspace: { workspaceId: BigInt(row.workspace_id), name: row.name, businessNumbers: row.business_numbers },
    region: { codeValueId: BigInt(row.region_code_value_id), code: row.region_code, scheme: row.region_scheme, label: row.region_label },
    item: itemOf(row.item_scheme, row.item_code),
    state: known(SEAT_STATES, row.state, "market seat state"),
    startsAt: instantOf(row.starts_at),
    endsAt: instantOf(row.ends_at),
    priorityStartedAt: instantOf(row.priority_started_at),
    events: row.events.map((event) => ({
      kind: known(EVENT_KINDS, event.kind, "market seat event kind"),
      occurredAt: instantOf(event.occurred_at),
      reason: known(REASONS, event.reason_code, "market seat reason"),
      memo: event.memo,
      actorPrincipalId: event.actor_principal_id === null ? null : BigInt(event.actor_principal_id),
      previousEndsAt: optionalInstant(event.previous_ends_at),
      nextEndsAt: optionalInstant(event.next_ends_at),
    })),
  };
}
