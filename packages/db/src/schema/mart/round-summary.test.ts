import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { orgRoundSummary, orgRoundSummaryItem } from "./round-summary";
import {
  checkNames,
  columnNames,
  columnSqlTypes,
  foreignKeyColumnSets,
  forbiddenMartColumns,
  indexNames,
  migrationSql,
} from "./table-config.fixture";

const martTablesMigration = "20260905223623_mart_decision_tables";

describe("mart.org_round_summary 스키마", () => {
  test("회차 1행이 grain이고 첫 열이 build 계보다", () => {
    const config = getTableConfig(orgRoundSummary);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("org_round_summary");
    expect(columnNames(orgRoundSummary)[0]).toBe("build_id");
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "build_id",
      "auction_attempt_id",
    ]);
  });

  test("계보 자유 문자열을 버리고 어느 해석을 요약했는지 남긴다", () => {
    const names = columnNames(orgRoundSummary);

    expect(names).not.toContain("mart_release");
    expect(names).not.toContain("computed_at");
    expect(names).not.toContain("calc_version");
    expect(names).toContain("auction_revision_id");
    expect(foreignKeyColumnSets(orgRoundSummary)).toContainEqual({
      columns: ["build_id"],
      foreignTable: "build",
    });
    expect(foreignKeyColumnSets(orgRoundSummary)).toContainEqual({
      columns: ["winner_supplier_party_id"],
      foreignTable: "supplier_party",
    });
  });

  test("비율 열의 축이 이름에 있고 축마다 자릿수가 다르다", () => {
    const types = columnSqlTypes(orgRoundSummary);

    expect(types.awarded_assessment_rate).toBe("numeric(15, 3)");
    expect(types.runner_up_assessment_rate).toBe("numeric(15, 3)");
    expect(types.awarded_bid_rate).toBe("numeric(9, 4)");
    expect(types.day_floor_bid_rate).toBe("numeric(9, 4)");
    expect(types.floor_rate).toBe("numeric(6, 3)");
    expect(types.base_amount).toBe("numeric(18, 2)");
    expect(types.planned_amount).toBe("numeric(18, 2)");
    expect(types.day_floor_amount).toBe("numeric(18, 2)");
    expect(columnNames(orgRoundSummary)).not.toContain("win_rate");
    expect(columnNames(orgRoundSummary)).not.toContain("second_rate");
    expect(columnNames(orgRoundSummary)).not.toContain("day_floor_rate");
  });

  test("파생 열은 mart에서 정당하지만 승패·무효 어간은 여기서도 금지다", () => {
    const names = columnNames(orgRoundSummary);

    // mart는 파생값이 사는 자리이므로 core의 파생 금지 규칙을 그대로 옮기지 않는다.
    expect(names).toContain("day_floor_amount");
    expect(names).toContain("below_day_floor_count");
    expect(names).toContain("awarded_bid_rate");
    // 그러나 유효·무효 판정은 원본 `BID_STT` 밖에서 우리가 하지 않는다.
    expect(forbiddenMartColumns(orgRoundSummary)).toEqual([]);
    expect(names).not.toContain("invalid_count");
  });

  test("사슬 미확인과 사슬 없음을 한 값으로 숨기지 않는다", () => {
    expect(columnSqlTypes(orgRoundSummary).lineage_status).toBe("varchar(16)");
    expect(checkNames(orgRoundSummary)).toContain("org_round_summary_lineage_status_allowed");
  });

  test("파생 열은 자기 재료 없이 값을 가질 수 없다", () => {
    const checks = checkNames(orgRoundSummary);

    expect(checks).toContain("org_round_summary_day_floor_requires_planned_amount");
    expect(checks).toContain("org_round_summary_below_day_floor_needs_floor_rate");
    expect(checks).toContain("org_round_summary_below_day_floor_within_list");
  });

  test("읽기 인덱스가 build를 앞세우고 어댑터 정렬과 같은 순서를 갖는다", () => {
    expect(indexNames(orgRoundSummary)).toEqual([
      "org_round_summary_build_org_announced_idx",
    ]);

    const sql = migrationSql(martTablesMigration);
    expect(sql).toContain(
      'CREATE INDEX "org_round_summary_build_org_announced_idx" ON "mart"."org_round_summary" '
        + '("build_id","organization_id","announced_at" DESC NULLS LAST,"auction_attempt_id" DESC NULLS LAST)',
    );
  });

  test("옛 표를 남기지 않고 build 계보를 가진 표로 교체한다", () => {
    const sql = migrationSql(martTablesMigration);

    expect(sql).toContain('DROP TABLE "mart"."org_round_summary"');
    expect(sql).toContain('CREATE TABLE "mart"."org_round_summary"');
  });

  test("mart 표마다 building build에만 쓰게 하는 trigger를 붙인다", () => {
    const sql = migrationSql(martTablesMigration);

    for (const table of [
      "org_round_summary",
      "win_rate_distribution_monthly",
      "open_auction_snapshot",
      "build_coverage",
    ]) {
      expect(sql).toContain(`CREATE TRIGGER "${table}_build_is_building"`);
      expect(sql).toContain(`ON "mart"."${table}"`);
    }
    expect(sql).toContain('EXECUTE FUNCTION "mart"."enforce_mart_row_build_is_building"()');
  });
});

describe("mart.org_round_summary_item 스키마", () => {
  test("품목은 요약 열이 아니라 회차 grain에 매달린 다리표이며 요약 행과 함께 지워진다", () => {
    const config = getTableConfig(orgRoundSummaryItem);

    expect(config.schema).toBe("mart");
    expect(columnNames(orgRoundSummary)).not.toContain("item_code_value_id");
    expect(columnNames(orgRoundSummaryItem)).toEqual(["build_id", "auction_attempt_id", "item_code_value_id"]);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual([
      "build_id",
      "auction_attempt_id",
      "item_code_value_id",
    ]);
    const summaryLink = config.foreignKeys.find((key) => key.reference().foreignTable === orgRoundSummary);
    expect(summaryLink?.reference().columns.map((column) => column.name)).toEqual(["build_id", "auction_attempt_id"]);
    expect(summaryLink?.onDelete).toBe("cascade");
    expect(indexNames(orgRoundSummaryItem)).toEqual(["org_round_summary_item_build_code_idx"]);
  });
});
