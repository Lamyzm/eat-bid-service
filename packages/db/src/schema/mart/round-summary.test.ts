import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orgRoundSummary } from "./round-summary";

describe("mart.org_round_summary 스키마", () => {
  test("회차 1행이 grain이며 기관·공고 시각 역순 인덱스를 가진다", () => {
    const config = getTableConfig(orgRoundSummary);
    expect(config.schema).toBe("mart");
    expect(config.name).toBe("org_round_summary");
    expect(config.primaryKeys.length + config.columns.filter((c) => c.primary).length).toBeGreaterThan(0);
    expect(config.indexes.map((index) => index.config.name)).toContain("org_round_summary_org_announced_idx");
  });

  test("비율 열은 소수 셋째 자리 numeric이고 금액은 통화를 동반한다", () => {
    const columns = Object.fromEntries(getTableConfig(orgRoundSummary).columns.map((c) => [c.name, c]));
    expect(columns.win_rate.getSQLType()).toBe("numeric(6, 3)");
    expect(columns.base_amount.getSQLType()).toBe("numeric(18, 2)");
    expect(columns.currency.notNull).toBe(true);
  });
});
