/**
 * @module 책임: 감시 회차가 판정한 위반의 수명(열림→관측→해소)과 그 위반에 대해 보낸 알림 한 통 한 통을 `monitoring` 스키마의 표 둘로 소유한다.
 *
 * 왜 표인가: 2026-09-16까지 열린 위반 목록은 R2 JSON 한 덩어리였고, PostgreSQL을 보는 Grafana도 psql을 쓰는
 * 에이전트도 그것을 읽지 못했다. 그 사이 `ci-main-green` 위반이 5일 동안 억제된 채 방치됐다. 나이·이력·재알림
 * 판정이 사람과 기계가 같이 읽는 표 하나에서 나야 한다(ADR 0054 결정 2).
 *
 * 왜 해소된 행을 지우지 않는가: "이 기대가 얼마나 자주 어떻게 깨지나"의 유일한 근거다. 열린 행만 환경·키당
 * 하나로 제한하고 이력은 쌓인다.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";
import { monitoringSchema } from "../namespaces.js";

export const VIOLATION_SEVERITIES = ["critical", "normal"] as const;
export const VIOLATION_OBSERVATIONS = ["observed", "unobserved"] as const;
export const NOTIFICATION_KINDS = ["opened", "repeat", "resolved", "digest"] as const;

export const monitoringViolation = monitoringSchema.table(
  "violation",
  {
    violationId: bigint("violation_id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    environment: varchar("environment", { length: 16 }).notNull(),
    // 기대 key 또는 `기대 key:행 key`. 열린 행의 정체성이자 R2 시절 상태 문서의 key와 같은 값이라 이관이 잇는다.
    violationKey: varchar("violation_key", { length: 200 }).notNull(),
    expectationKey: varchar("expectation_key", { length: 64 }).notNull(),
    // 재알림 정책이 매달리는 열이다(ADR 0054 결정 1). 기대 선언이 정하고 회차마다 다시 쓴다 — 분류가 바뀌면
    // 열린 위반도 새 정책을 따라야 한다.
    severity: varchar("severity", { length: 16 }).notNull(),
    title: text("title").notNull(),
    detail: text("detail").notNull(),
    runbook: text("runbook").notNull(),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull(),
    // 이번 회차에 실제로 관측된 마지막 시각. 평가가 실패한 회차에는 갱신하지 않는다.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    // observed | unobserved. 기대 평가가 실패해 이전 상태를 물려받은 위반은 해소가 아니라 관측 안 됨이다(EAT-242).
    observation: varchar("observation", { length: 16 }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("monitoring_violation_open_key_unique")
      .on(table.environment, table.violationKey)
      .where(sql`${table.resolvedAt} is null`),
    index("monitoring_violation_environment_resolved_idx").on(table.environment, table.resolvedAt),
    check(
      "monitoring_violation_severity",
      sql`${table.severity} in ('critical', 'normal')`,
    ),
    check(
      "monitoring_violation_observation",
      sql`${table.observation} in ('observed', 'unobserved')`,
    ),
    check(
      "monitoring_violation_timeline",
      sql`${table.lastSeenAt} >= ${table.firstSeenAt}
        and (${table.resolvedAt} is null or ${table.resolvedAt} >= ${table.firstSeenAt})`,
    ),
  ],
);

export const monitoringNotification = monitoringSchema.table(
  "notification",
  {
    notificationId: bigint("notification_id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    environment: varchar("environment", { length: 16 }).notNull(),
    // 요약(digest)은 위반 하나에 매이지 않아 NULL이다. 그 외는 위반 하나당 한 행이다 — 한 통에 셋을 묶어 보내면
    // 행 셋이 같은 sent_at을 갖는다.
    violationId: bigint("violation_id", { mode: "bigint" }).references(() => monitoringViolation.violationId),
    kind: varchar("kind", { length: 16 }).notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    // 전송 실패도 행이다. 알림이 안 간 상태가 정상으로 보이면 안 된다.
    ok: boolean("ok").notNull(),
    error: text("error"),
  },
  (table) => [
    index("monitoring_notification_environment_sent_idx").on(table.environment, table.sentAt),
    check(
      "monitoring_notification_kind",
      sql`${table.kind} in ('opened', 'repeat', 'resolved', 'digest')`,
    ),
    check(
      "monitoring_notification_error_only_on_failure",
      sql`${table.ok} or ${table.error} is not null`,
    ),
  ],
);
