/**
 * @module 책임: 공고 하나의 추천 금액을 어느 워크스페이스가 맡았는지의 이력을 사용자 작성 상태의 권위로 소유한다(ADR 0071
 * 결정 2~5).
 *
 * "누가 맡았나"는 자리와 공고에서 다시 계산할 수 없다. 자리 기간이 잘리고 정정공고가 오면 같은 계산이 다른 답을 내기
 * 때문이다. 그래서 금액을 내보내기 전에 이 표에 먼저 쓰고, 쓰지 못하면 금액 없이 응답한다(fail-closed). 화면 장부
 * (`bid_display_record`)는 "무엇을 보였나", 이 표는 "누가 받을 자격이 있었나"다.
 */
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";

import { appSchema } from "../namespaces.js";
import { marketSeat } from "./market-seats.js";
import { principal } from "./principals.js";
import { workspace } from "./workspaces.js";

/**
 * 공고마다 지금 유효한 줄(`superseded_at`이 빈 줄)은 하나뿐이다. 동시 요청은 이 부분 unique에 `on conflict do nothing`으로
 * 부딪힌 뒤 같은 연결에서 다시 읽어 한 곳만 맡는다.
 *
 * 줄은 지우지 않는다. 맡은 업체가 바뀌거나(`handed_over`), 마감 뒤 확정되거나(`confirmed`), 운영자가 바로잡으면(`corrected`)
 * 이전 줄에 `superseded_at`을 채우고 새 줄을 더한다.
 */
export const auctionAmountAssignment = appSchema.table(
  "auction_amount_assignment",
  {
    auctionAmountAssignmentId: bigint("auction_amount_assignment_id", { mode: "bigint" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),
    // `core.auction_attempt`의 번호지만 FK를 걸지 않는다. 화면 장부와 같은 이유다 — FK 마이그레이션이 백필 투영이 몇 시간씩
    // 쓰는 공고 표에 잠금을 잡아야 해 배포가 막힌다. 공고 행은 지우지 않으므로 끊긴 번호가 생기지 않는다(ADR 0068).
    auctionAttemptId: bigint("auction_attempt_id", { mode: "bigint" }).notNull(),
    workspaceId: bigint("workspace_id", { mode: "bigint" }).notNull(),
    marketSeatId: bigint("market_seat_id", { mode: "bigint" }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    // 판정에 쓴 공고 개정본의 관측 번호다. 최신 개정본은 관측 번호 순으로 고르므로(ADR 0065) 정정공고 반영 여부를 되짚는 열쇠다.
    basisObservationId: bigint("basis_observation_id", { mode: "bigint" }).notNull(),
    // 배정 규칙의 판이다. 규칙이 바뀐 뒤에도 그때 왜 이 업체였는지 다시 따질 수 있어야 한다.
    ruleVersion: varchar("rule_version", { length: 32 }).notNull(),
    // 판정 때 공고에 걸쳤던 자리 번호 전부다. 맡은 자리 하나만 남기면 "다른 후보가 있었나"를 나중에 알 수 없다.
    candidateMarketSeatIds: bigint("candidate_market_seat_ids", { mode: "bigint" }).array().notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    // 비어 있으면 금액 요청이나 매일 확정 작업이 쓴 줄이다. 운영자 정정만 사람이 쓴다.
    actorPrincipalId: bigint("actor_principal_id", { mode: "bigint" }),
    reason: text("reason"),
  },
  (table) => [
    // 표 이름이 길어 자동 FK 이름이 해시로 잘린다. 뒤 마이그레이션이 이름을 맞힐 수 있게 고정한다.
    foreignKey({
      name: "auction_amount_assignment_workspace_fkey",
      columns: [table.workspaceId],
      foreignColumns: [workspace.workspaceId],
    }),
    foreignKey({
      name: "auction_amount_assignment_market_seat_fkey",
      columns: [table.marketSeatId],
      foreignColumns: [marketSeat.marketSeatId],
    }),
    foreignKey({
      name: "auction_amount_assignment_actor_fkey",
      columns: [table.actorPrincipalId],
      foreignColumns: [principal.principalId],
    }),
    uniqueIndex("auction_amount_assignment_current_key")
      .on(table.auctionAttemptId)
      .where(sql`${table.supersededAt} is null`),
    index("auction_amount_assignment_attempt_idx").on(table.auctionAttemptId, table.recordedAt),
    index("auction_amount_assignment_workspace_idx").on(table.workspaceId, table.recordedAt),
    check(
      "auction_amount_assignment_kind_known",
      sql`${table.kind} in ('took', 'handed_over', 'confirmed', 'corrected')`,
    ),
    check(
      "auction_amount_assignment_superseded_after_recorded",
      sql`${table.supersededAt} is null or ${table.supersededAt} >= ${table.recordedAt}`,
    ),
    // 사람이 바꾼 줄은 이유 없이 남지 않는다.
    check(
      "auction_amount_assignment_correction_has_reason",
      sql`${table.kind} <> 'corrected' or (${table.actorPrincipalId} is not null and length(btrim(${table.reason})) > 0)`,
    ),
    check(
      "auction_amount_assignment_candidate_includes_seat",
      sql`${table.marketSeatId} = any(${table.candidateMarketSeatIds})`,
    ),
  ],
);
