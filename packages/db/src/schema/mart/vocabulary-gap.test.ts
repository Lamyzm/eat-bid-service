import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import { martBuildVocabularyGap } from "./vocabulary-gap";
import { checkNames, columnNames, columnNullability, foreignKeyColumnSets } from "./table-config.fixture";

describe("mart.build_vocabulary_gap 스키마", () => {
  test("격리 조각은 (build, 어휘, 조각)이 grain이고 첫 열이 build 계보다", () => {
    const config = getTableConfig(martBuildVocabularyGap);

    expect(config.schema).toBe("mart");
    expect(config.name).toBe("build_vocabulary_gap");
    expect(columnNames(martBuildVocabularyGap)).toEqual(["build_id", "scheme_namespace", "fragment", "row_count"]);
    expect(config.primaryKeys[0]?.columns.map((column) => column.name)).toEqual(["build_id", "scheme_namespace", "fragment"]);
  });

  test("조각은 코드가 아니라 격리된 관측이라 code_value를 가리키지 않고 build만 가리킨다", () => {
    expect(foreignKeyColumnSets(martBuildVocabularyGap)).toEqual([{ columns: ["build_id"], foreignTable: "build" }]);
    expect(columnNullability(martBuildVocabularyGap).fragment).toBe(true);
  });

  test("0행짜리 격리와 빈 조각을 막는다", () => {
    const checks = checkNames(martBuildVocabularyGap);
    expect(checks).toContain("mart_build_vocabulary_gap_row_count_positive");
    expect(checks).toContain("mart_build_vocabulary_gap_fragment_present");
  });
});
