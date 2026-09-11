import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

describe("워크스페이스 관심 지역 schema", () => {
  test("확인 도장을 지역 목록과 다른 표에 두어 미설정과 빈 선택을 구분한다", async () => {
    const schema = await import("./index");
    const preference = getTableConfig(schema.workspaceRegionPreference);
    const area = getTableConfig(schema.workspaceRegionPreferenceArea);

    expect(preference.schema).toBe("app");
    expect(area.schema).toBe("app");
    expect(preference.columns.map((column) => column.name).sort()).toEqual([
      "confirmed_at",
      "confirmed_by_principal_id",
      "workspace_id",
    ]);
    // 확인 시각은 결측일 수 없다. 행이 있으면 확인한 것이고, 미설정은 행의 부재로 표현한다.
    expect(preference.columns.find((column) => column.name === "confirmed_at")?.notNull).toBe(true);
    expect(area.columns.map((column) => column.name).sort()).toEqual(["code_value_id", "workspace_id"]);
  });

  test("지역은 문자열이 아니라 core code value의 숫자 id로 참조한다", async () => {
    const schema = await import("./index");
    const area = getTableConfig(schema.workspaceRegionPreferenceArea);

    expect(area.columns.every((column) => column.columnType === "PgBigInt64")).toBe(true);
    expect(area.columns.map((column) => column.name)).not.toContain("code");
    expect(area.columns.map((column) => column.name)).not.toContain("label");
    // 워크스페이스 경계와 코드 정체성을 둘 다 FK로 강제한다.
    expect(area.foreignKeys).toHaveLength(2);
    expect(area.foreignKeys.flatMap((key) => key.reference().foreignColumns.map((column) => column.name)).sort())
      .toEqual(["code_value_id", "workspace_id"]);
  });

  test("같은 코드를 두 번 고를 수 없고 선택 개수 상한은 두지 않는다", async () => {
    const schema = await import("./index");
    const area = getTableConfig(schema.workspaceRegionPreferenceArea);

    expect(area.primaryKeys[0]!.columns.map((column) => column.name)).toEqual([
      "workspace_id",
      "code_value_id",
    ]);
    // 개수 상한을 DDL에 박으면 시군구로 쪼개진 지역의 업체를 저장 계층이 배제하게 된다(ADR 0048 결정 4).
    expect(area.checks).toHaveLength(0);
  });
});
