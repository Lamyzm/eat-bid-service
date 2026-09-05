import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { distributionScopes, winRateDistributionMonthly } from "./win-rate-distribution";
import {
  checkNames,
  columnNames,
  columnNullability,
  columnSqlTypes,
  foreignKeyColumnSets,
  nullsNotDistinctUniqueColumnSets,
} from "./table-config.fixture";

describe("mart.win_rate_distribution_monthly 스키마", () => {
  test("모집단 넷과 코호트 키를 grain으로 갖고 첫 열이 build 계보다", () => {
    const config = getTableConfig(winRateDistributionMonthly);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("win_rate_distribution_monthly");
    expect(columnNames(winRateDistributionMonthly)[0]).toBe("build_id");
    expect([...distributionScopes]).toEqual(["national", "province", "district", "organization"]);
    expect(foreignKeyColumnSets(winRateDistributionMonthly)).toContainEqual({
      columns: ["build_id"],
      foreignTable: "build",
    });
  });

  test("scope별로 비는 축이 unique 키를 빠져나가지 못한다", () => {
    expect(nullsNotDistinctUniqueColumnSets(winRateDistributionMonthly)).toEqual([
      [
        "build_id",
        "scope",
        "region_code_value_id",
        "organization_id",
        "item_code_value_id",
        "floor_rate",
        "award_method_code_value_id",
        "month_kst",
        "bin_lower",
      ],
    ]);
    expect(checkNames(winRateDistributionMonthly)).toContain(
      "win_rate_distribution_monthly_scope_axis_required",
    );
  });

  test("하한율과 낙찰 방식은 코호트 키이므로 비울 수 없다", () => {
    const nullability = columnNullability(winRateDistributionMonthly);

    expect(nullability.floor_rate).toBe(true);
    expect(nullability.award_method_code_value_id).toBe(true);
    expect(nullability.month_kst).toBe(true);
  });

  test("구간 경계는 사정률 축의 자릿수를 그대로 쓴다", () => {
    const types = columnSqlTypes(winRateDistributionMonthly);

    expect(types.bin_lower).toBe("numeric(15, 3)");
    expect(types.bin_width).toBe("numeric(15, 3)");
    expect(types.month_kst).toBe("date");
    expect(types.attempt_count).toBe("bigint");
  });

  test("빈 칸을 행으로 만들지 않고 폭이 0인 구간도 만들지 않는다", () => {
    const checks = checkNames(winRateDistributionMonthly);

    expect(checks).toContain("win_rate_distribution_monthly_attempt_count_positive");
    expect(checks).toContain("win_rate_distribution_monthly_bin_width_positive");
  });
});
