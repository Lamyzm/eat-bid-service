/**
 * @module 책임: 소스가 우리를 막았을 때 "언제까지 부르지 않는다"는 결정을 `ingest.source_hold`로 소유한다.
 *
 * 왜 표인가: 진도는 사실에서 파생하지만(ADR 0052 결정 2, `backfill_coverage`) 이것은 진도가 아니라 결정이다.
 * CronWorkflow는 다음 정시에 새 Workflow를 띄우므로 프로세스 안 재시도도 `retryStrategy`도 그 경계를 넘지
 * 못한다. 결정이 표에 있어야 다음 실행이 읽는다(ADR 0055).
 *
 * 왜 소스 단위인가: 차단은 창이 아니라 우리 IP에 걸린다. 창을 바꿔 부르면 더 빨리 굳는다.
 */
import { sql } from "drizzle-orm";
import { bigint, check, index, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { ingestSchema } from "../namespaces.js";

export const SOURCE_HOLD_REASONS = ["source-throttled"] as const;

export const ingestSourceHold = ingestSchema.table(
  "source_hold",
  {
    holdId: bigint("hold_id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    source: varchar("source", { length: 32 }).notNull(),
    reason: varchar("reason", { length: 32 }).notNull(),
    // 어느 run이 어떤 응답을 봤나. 사람이 보류를 읽을 때 근거가 여기 있다.
    detail: text("detail").notNull(),
    heldAt: timestamp("held_at", { withTimezone: true }).notNull(),
    heldByRunId: uuid("held_by_run_id"),
    // 이 시각이 지나면 보류가 풀린다. 지수로 늘고 24시간이 상한이다(ADR 0055 결정 2).
    releaseAfter: timestamp("release_after", { withTimezone: true }).notNull(),
    // 사람이 일찍 풀었을 때만. 지금은 쓰는 자리가 없다 — 수동 운영 쓰기 금지 원칙과 부딪히므로 필요해지면
    // Workflow 진입점으로 시스템이 쓴다.
    releasedAt: timestamp("released_at", { withTimezone: true }),
  },
  (table) => [
    index("ingest_source_hold_source_release_idx").on(table.source, table.releaseAfter),
    check("ingest_source_hold_reason", sql`${table.reason} in ('source-throttled')`),
    check("ingest_source_hold_release_after_held", sql`${table.releaseAfter} > ${table.heldAt}`),
  ],
);
