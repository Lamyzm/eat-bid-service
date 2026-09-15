/**
 * @module 책임: 감시 회차(`check-expectations`)가 끝에 남기는 모양 지표 `monitoring.round`를 소유한다.
 *
 * 알림의 근거가 아니라 사람이 보는 선이다. ADR 0046 결정 4는 지표로 판정하지 말라고 했지 지표를 두지
 * 말라고 하지 않았다. 상태 문서와 달리 덮어쓰는 값이 아니라 쌓이는 사실이라 회차당 한 행을 둔다
 * (하루 96행, 한 해 3만5천 행이라 보존 정책 없이 둔다).
 */
import { sql } from "drizzle-orm";
import { check, integer, jsonb, primaryKey, timestamp, varchar } from "drizzle-orm/pg-core";
import { monitoringSchema } from "../namespaces.js";

export const monitoringRound = monitoringSchema.table(
  "round",
  {
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    environment: varchar("environment", { length: 16 }).notNull(),
    // mode별 수를 jsonb로 둔다. mode 목록은 수집기가 소유하므로 열로 박으면 mode를 더할 때마다
    // migration이 따라와야 한다. 표본이 없는 회차는 빈 객체이지 NULL이 아니다.
    runsStarted1h: jsonb("runs_started_1h").$type<Record<string, number>>().notNull(),
    runsFailed1h: jsonb("runs_failed_1h").$type<Record<string, number>>().notNull(),
    auctionsPublished1h: integer("auctions_published_1h").notNull(),
    openAuctionsNow: integer("open_auctions_now").notNull(),
    backfillWindowsIncomplete: integer("backfill_windows_incomplete").notNull(),
    violationsOpen: integer("violations_open").notNull(),
    checkDurationMs: integer("check_duration_ms").notNull(),
  },
  (table) => [
    // 환경이 앞에 오는 이유: 읽기는 언제나 "이 환경의 최근 96행"이다.
    primaryKey({ name: "monitoring_round_pkey", columns: [table.environment, table.observedAt] }),
    check(
      "monitoring_round_counts_nonnegative",
      sql`${table.auctionsPublished1h} >= 0
        and ${table.openAuctionsNow} >= 0
        and ${table.backfillWindowsIncomplete} >= 0
        and ${table.violationsOpen} >= 0
        and ${table.checkDurationMs} >= 0`,
    ),
    check(
      "monitoring_round_counts_are_objects",
      sql`jsonb_typeof(${table.runsStarted1h}) = 'object' and jsonb_typeof(${table.runsFailed1h}) = 'object'`,
    ),
  ],
);
