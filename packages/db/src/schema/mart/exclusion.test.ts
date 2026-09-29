import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { martBuildExclusionMonth, martBuildStaleAuction } from "./exclusion";
import { checkNames, columnNames, foreignKeyColumnSets, migrationSql } from "./table-config.fixture";

const exclusionMigration = "20260928230639_mart_build_exclusion";

describe("mart 제외 부속 표 스키마", () => {
  test("달별 제외 수는 build와 달로 한 행이고 발행 수와 섞지 않는다", () => {
    const config = getTableConfig(martBuildExclusionMonth);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("build_exclusion_month");
    expect(columnNames(martBuildExclusionMonth)).toEqual([
      "build_id",
      "month_kst",
      "excluded_auction_count",
      "unresolved_auction_count",
    ]);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["build_id", "month_kst"]);
    expect(checkNames(martBuildExclusionMonth)).toContain("mart_build_exclusion_month_excluded_positive");
    expect(checkNames(martBuildExclusionMonth)).toContain(
      "mart_build_exclusion_month_unresolved_within_excluded",
    );
  });

  test("최신 관측 미반영 공고는 내부 숫자 ID로 core 회차와 현행 revision을 가리킨다", () => {
    const config = getTableConfig(martBuildStaleAuction);

    expect(config.name).toBe("build_stale_auction");
    expect(columnNames(martBuildStaleAuction)[0]).toBe("build_id");
    expect(columnNames(martBuildStaleAuction)).not.toContain("external_bid_id");
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "build_id",
      "auction_attempt_id",
    ]);
    expect(foreignKeyColumnSets(martBuildStaleAuction)).toEqual(expect.arrayContaining([
      { columns: ["auction_attempt_id"], foreignTable: "auction_attempt" },
      { columns: ["auction_revision_id"], foreignTable: "auction_revision" },
    ]));
    expect(checkNames(martBuildStaleAuction)).toContain("mart_build_stale_auction_excluded_after_reflected");
  });

  test("두 표 모두 building build에만 쓰게 하는 trigger를 붙인다", () => {
    const sql = migrationSql(exclusionMigration);

    for (const table of ["build_exclusion_month", "build_stale_auction"]) {
      expect(sql).toContain(`CREATE TRIGGER "${table}_build_is_building"`);
      expect(sql).toContain(`ON "mart"."${table}"`);
    }
  });
});
