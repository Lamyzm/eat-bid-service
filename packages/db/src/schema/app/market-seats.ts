/**
 * @module 책임: 워크스페이스가 추천 금액을 받을 권리인 시장 자리와, 자리 기간 동안 묶인 사업자번호와, 자리 변경 기록을
 * 사용자 작성 상태로 소유한다(ADR 0071 결정 1·6·7, PDR-0010).
 *
 * 기간은 `starts_at`·`ends_at` 두 열이고 겹침 판정은 `tstzrange(starts_at, ends_at)`, 곧 반열림 `[시작, 끝)`이다. 한 자리의
 * 끝과 다음 자리의 시작이 같은 시각이면 겹치지 않는다. range 타입 열 대신 두 열을 두는 이유는 Drizzle이 range 타입을
 * 선언하지 못하고, 서버가 이미 `timestamptz`를 Temporal.Instant로 옮기는 경로를 쓰기 때문이다.
 *
 * 겹침 금지는 이 파일에 보이지 않는다. PostgreSQL `btree_gist` exclusion constraint는 Drizzle 스키마로 선언할 수 없어
 * `drizzle-kit generate --custom` 마이그레이션 SQL에 있다(ADR 0071 결정 8). 이름은
 * `market_seat_no_overlap`과 `seat_business_claim_one_workspace`이고, 통합 테스트가 그 둘이 살아 있는지 지킨다.
 */
import { sql } from "drizzle-orm";
import { bigint, char, check, foreignKey, index, text, timestamp, varchar } from "drizzle-orm/pg-core";

import { codeValue } from "../core/codes.js";
import { appSchema } from "../namespaces.js";
import { principal } from "./principals.js";
import { workspace } from "./workspaces.js";

/**
 * 자리 한 줄은 워크스페이스 하나가 (참가제한지역 코드, 품목 코드) 하나를 기간 동안 쓰는 것이다.
 *
 * 상태마다 기간의 끝이 뜻하는 바가 다르다. 선점(`held`)의 끝은 선점 마감 시각이라, 치우는 작업이 죽어도 저절로 풀린다.
 * 활성(`active`)의 끝은 자리가 끝나는 시각이다. 되찾기(`reclaim`)는 끝난 원래 업체만 되살 수 있는 24시간, 제안(`offer`)은
 * 대기 1순위에게 준 48시간이다. 네 상태 모두 기간 동안 다른 워크스페이스가 같은 자리를 잡지 못하게 하므로 한 제약에 든다.
 * 회수와 취소는 행을 지우지 않고 끝을 그 시각으로 자른다. 시작 시각에 자르면 빈 기간이 되어 아무것과도 겹치지 않는다.
 *
 * 지역·품목이 그 코드 체계의 값인지는 FK로 묶을 수 없다(`code_value_id` 하나로는 체계를 표현하지 못한다). 그 판정은 자리를
 * 만드는 command가 같은 transaction에서 한다.
 */
export const marketSeat = appSchema.table(
  "market_seat",
  {
    marketSeatId: bigint("market_seat_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    // eaT 참가제한지역 code value다. 지역은 코드가 정확히 같을 때만 같은 시장이다(부산 전체 제한 ≠ 해운대구 제한).
    regionCodeValueId: bigint("region_code_value_id", { mode: "bigint" }).notNull(),
    // 공고 개정본의 role `item` code value다.
    itemCodeValueId: bigint("item_code_value_id", { mode: "bigint" }).notNull(),
    state: varchar("state", { length: 16 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    // 같은 공고에 걸친 자리가 여럿이면 이 시각이 이른 자리가 맡는다. 연장과 24시간 안의 되찾기로 바뀌지 않으므로 기간
    // 시작과 따로 둔다. 과거로 넣지 못하게 하는 것은 command의 일이다 — 운영자 정정으로 바로잡을 길은 남겨야 한다.
    priorityStartedAt: timestamp("priority_started_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // 지역과 품목이 같은 표(`core.code_value`)를 가리켜 자동 이름이 해시로 나온다. 뒤 마이그레이션이 이름을 맞힐 수 있게 고정한다.
    foreignKey({
      name: "market_seat_region_code_value_fkey",
      columns: [table.regionCodeValueId],
      foreignColumns: [codeValue.codeValueId],
    }),
    foreignKey({
      name: "market_seat_item_code_value_fkey",
      columns: [table.itemCodeValueId],
      foreignColumns: [codeValue.codeValueId],
    }),
    index("market_seat_workspace_idx").on(table.workspaceId, table.endsAt),
    check("market_seat_state_known", sql`${table.state} in ('held', 'active', 'reclaim', 'offer')`),
    check("market_seat_period_order", sql`${table.startsAt} <= ${table.endsAt}`),
    check("market_seat_priority_not_after_start", sql`${table.priorityStartedAt} <= ${table.startsAt}`),
  ],
);

/**
 * 자리를 가진 워크스페이스가 그 기간 동안 쓰는 사업자번호 한 줄이다.
 *
 * 한 업체가 워크스페이스 둘로 자리를 사면 같은 공고에서 자기 금액끼리 부딪혀 이득이 사라진다(ADR 0071 결정 6). 그래서
 * 같은 번호는 같은 기간에 다른 워크스페이스에 묶이지 못한다. 등록(`registered_business`)의 전역 선점을 막은 ADR 0032 §7과
 * 다른 판단인 이유는 이 줄이 등록만으로는 생기지 않고 자리를 잡을 때(선점 포함)만 생기기 때문이다. 번호를 남이 먼저
 * 묶었다면 운영자가 확인해 기간을 자른다.
 *
 * 선점 때 함께 만들어 돈이 나가기 전에 충돌을 알고, 기간 끝을 선점 마감으로 두어 선점이 풀리면 이 줄도 저절로 풀린다.
 */
export const seatBusinessClaim = appSchema.table(
  "seat_business_claim",
  {
    seatBusinessClaimId: bigint("seat_business_claim_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    workspaceId: bigint("workspace_id", { mode: "bigint" })
      .notNull()
      .references(() => workspace.workspaceId),
    // 정규화된 사업자등록번호 10자리다. 대조 키이지 식별자가 아니다(`registered_business`와 같다).
    businessNumber: char("business_number", { length: 10 }).notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("seat_business_claim_workspace_idx").on(table.workspaceId, table.endsAt),
    check("seat_business_claim_number_digits", sql`${table.businessNumber} ~ '^[0-9]{10}$'`),
    check("seat_business_claim_period_order", sql`${table.startsAt} <= ${table.endsAt}`),
  ],
);

/**
 * 자리의 선점·활성화·연장·회수·해제·되찾기·제안·정정을 누가, 왜 했는지 더하기만 하는 기록이다.
 *
 * 자리 행은 끝을 고쳐 쓰므로 그 행만으로는 "언제 누가 줄였나"가 사라진다. 운영자 분쟁과 환불 판단의 1차 자료라 바꾸기 전과
 * 뒤의 끝을 함께 남긴다. 만료는 기록하지 않는다 — 기간이 지나면 저절로 끝나는 것이 설계라 쓸 주체가 없다.
 */
export const marketSeatEvent = appSchema.table(
  "market_seat_event",
  {
    marketSeatEventId: bigint("market_seat_event_id", { mode: "bigint" }).generatedAlwaysAsIdentity().primaryKey(),
    marketSeatId: bigint("market_seat_id", { mode: "bigint" }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    // 비어 있으면 매일 작업 같은 시스템이 한 일이다.
    actorPrincipalId: bigint("actor_principal_id", { mode: "bigint" }),
    // 사유는 고정 목록에서 고르고 메모를 덧붙인다. 목록은 운영자 화면과 함께 정하므로 여기서는 비어 있지 않음만 지킨다.
    reasonCode: varchar("reason_code", { length: 32 }).notNull(),
    memo: text("memo"),
    previousEndsAt: timestamp("previous_ends_at", { withTimezone: true }),
    nextEndsAt: timestamp("next_ends_at", { withTimezone: true }),
  },
  (table) => [
    foreignKey({
      name: "market_seat_event_market_seat_fkey",
      columns: [table.marketSeatId],
      foreignColumns: [marketSeat.marketSeatId],
    }),
    foreignKey({
      name: "market_seat_event_actor_fkey",
      columns: [table.actorPrincipalId],
      foreignColumns: [principal.principalId],
    }),
    index("market_seat_event_seat_idx").on(table.marketSeatId, table.occurredAt),
    check(
      "market_seat_event_kind_known",
      sql`${table.kind} in ('held', 'activated', 'extended', 'revoked', 'released', 'reclaimed', 'offered', 'corrected')`,
    ),
    check("market_seat_event_reason_present", sql`length(btrim(${table.reasonCode})) > 0`),
  ],
);
