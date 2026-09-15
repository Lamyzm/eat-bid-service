import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { monitoringRound } from "./round";
import { checkNames, columnNames, columnNullability, migrationSql } from "../mart/table-config.fixture";

const roundMigration = "20260915205222_monitoring_round";

describe("monitoring.round 스키마", () => {
  test("회차 지표는 monitoring schema에 환경·시각을 키로 쌓인다", () => {
    const config = getTableConfig(monitoringRound);

    expect(config.schema).toBe("monitoring");
    expect(config.name).toBe("round");
    expect(config.primaryKeys.map((key) => key.columns.map((column) => column.name))).toEqual([
      ["environment", "observed_at"],
    ]);
  });

  test("계획이 정한 열 아홉이 전부 있고 어느 것도 NULL을 허용하지 않는다", () => {
    expect(columnNames(monitoringRound)).toEqual([
      "observed_at",
      "environment",
      "runs_started_1h",
      "runs_failed_1h",
      "auctions_published_1h",
      "open_auctions_now",
      "backfill_windows_incomplete",
      "violations_open",
      "check_duration_ms",
    ]);
    expect(Object.values(columnNullability(monitoringRound)).every((notNull) => notNull === true)).toBe(true);
  });

  test("표본이 없어도 0과 빈 객체로 남기지 음수나 NULL로 남기지 않는다", () => {
    const checks = checkNames(monitoringRound);

    expect(checks).toContain("monitoring_round_counts_nonnegative");
    expect(checks).toContain("monitoring_round_counts_are_objects");
  });

  test("migration이 schema와 표를 함께 만든다", () => {
    const sql = migrationSql(roundMigration);

    expect(sql).toContain('CREATE SCHEMA "monitoring"');
    expect(sql).toContain('CREATE TABLE "monitoring"."round"');
  });
});
