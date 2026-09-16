import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { monitoringNotification, monitoringViolation } from "./violation";
import { checkNames, columnNames, columnNullability, migrationSql } from "../mart/table-config.fixture";

const ledgerMigration = "20260916100437_monitoring_violation_ledger";

describe("monitoring.violation 스키마", () => {
  test("위반은 monitoring schema에 한 행씩 쌓이고 열린 행만 환경·키당 하나다", () => {
    const config = getTableConfig(monitoringViolation);

    expect(config.schema).toBe("monitoring");
    expect(config.name).toBe("violation");
    const openUnique = config.indexes.find((index) => index.config.name === "monitoring_violation_open_key_unique");
    expect(openUnique?.config.unique).toBe(true);
    expect(openUnique?.config.where).toBeDefined();
  });

  test("수명 열 셋과 정책 열 하나가 있고 해소·재알림 시각만 NULL을 허용한다", () => {
    expect(columnNames(monitoringViolation)).toEqual([
      "violation_id",
      "environment",
      "violation_key",
      "expectation_key",
      "severity",
      "title",
      "detail",
      "runbook",
      "first_seen_at",
      "last_seen_at",
      "observation",
      "resolved_at",
      "last_notified_at",
    ]);
    const nullability = columnNullability(monitoringViolation);
    expect(nullability.resolved_at).toBe(false);
    expect(nullability.last_notified_at).toBe(false);
    expect(nullability.first_seen_at).toBe(true);
    expect(nullability.severity).toBe(true);
  });

  test("심각도·관측·시간 순서는 DB가 지킨다", () => {
    const checks = checkNames(monitoringViolation);

    expect(checks).toContain("monitoring_violation_severity");
    expect(checks).toContain("monitoring_violation_observation");
    expect(checks).toContain("monitoring_violation_timeline");
  });
});

describe("monitoring.notification 스키마", () => {
  test("보낸 통은 위반 하나당 한 행이고 요약만 위반 없이 남는다", () => {
    expect(columnNames(monitoringNotification)).toEqual([
      "notification_id",
      "environment",
      "violation_id",
      "kind",
      "sent_at",
      "ok",
      "error",
    ]);
    expect(columnNullability(monitoringNotification).violation_id).toBe(false);
    expect(columnNullability(monitoringNotification).ok).toBe(true);
  });

  test("전송 실패 행은 반드시 오류를 든다", () => {
    const checks = checkNames(monitoringNotification);

    expect(checks).toContain("monitoring_notification_kind");
    expect(checks).toContain("monitoring_notification_error_only_on_failure");
  });

  test("migration이 표 둘과 부분 unique index를 만든다", () => {
    const sql = migrationSql(ledgerMigration);

    expect(sql).toContain('CREATE TABLE "monitoring"."violation"');
    expect(sql).toContain('CREATE TABLE "monitoring"."notification"');
    expect(sql).toContain('"monitoring_violation_open_key_unique"');
    expect(sql).toContain('WHERE "resolved_at" is null');
  });
});
