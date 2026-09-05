import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { coverageValues, martBuildCoverage } from "./coverage";
import {
  checkNames,
  columnNames,
  columnNullability,
  nullsNotDistinctUniqueColumnSets,
} from "./table-config.fixture";

describe("mart.build_coverage 스키마", () => {
  test("보유율을 (지역, 달)로 세고 첫 열이 build 계보다", () => {
    const config = getTableConfig(martBuildCoverage);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("build_coverage");
    expect(columnNames(martBuildCoverage)[0]).toBe("build_id");
    expect(nullsNotDistinctUniqueColumnSets(martBuildCoverage)).toEqual([
      ["build_id", "region_code_value_id", "month_kst"],
    ]);
  });

  test("모르는 보유율을 partial로 뭉개지 않고 unknown으로 말한다", () => {
    expect([...coverageValues]).toEqual(["complete", "partial", "none", "unknown"]);
    expect(checkNames(martBuildCoverage)).toContain("mart_build_coverage_value_allowed");
  });

  test("지역 축 없이 수집된 구간은 전국 행으로 남는다", () => {
    expect(columnNullability(martBuildCoverage).region_code_value_id).toBe(false);
    expect(columnNullability(martBuildCoverage).month_kst).toBe(true);
  });

  test("종단 수가 관측 수를 넘는 분모를 만들지 않는다", () => {
    const checks = checkNames(martBuildCoverage);

    expect(checks).toContain("mart_build_coverage_counts_nonnegative");
    expect(checks).toContain("mart_build_coverage_terminal_within_observed");
  });
});
