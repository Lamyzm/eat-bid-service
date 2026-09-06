import { describe, expect, test } from "bun:test";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { codeRelease, codeReleaseMember } from "./code-releases";

type Table = Parameters<typeof getTableConfig>[0];

const columnNames = (table: Table) => getTableConfig(table).columns.map((column) => column.name);

const columnSqlTypes = (table: Table) =>
  Object.fromEntries(getTableConfig(table).columns.map((column) => [column.name, column.getSQLType()]));

const columnNullability = (table: Table) =>
  Object.fromEntries(getTableConfig(table).columns.map((column) => [column.name, column.notNull]));

const primaryKeyColumns = (table: Table) =>
  getTableConfig(table).primaryKeys.flatMap((key) => key.columns.map((column) => column.name));

const foreignKeys = (table: Table) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      foreignTable: reference.foreignTable[Symbol.for("drizzle:Name")],
    };
  });

const checkExpression = (table: Table, name: string) => {
  const constraint = getTableConfig(table).checks.find((candidate) => candidate.name === name);
  if (constraint === undefined) throw new Error(`check constraint is missing: ${name}`);

  return new PgDialect().sqlToQuery(constraint.value).sql;
};

describe("정부 코드 release membership DDL", () => {
  test("release member는 release와 code value의 복합 정체성이다", () => {
    expect(primaryKeyColumns(codeReleaseMember)).toEqual(["code_release_id", "code_value_id"]);
  });

  test("member의 상위 코드는 같은 release 안에서만 가리킨다", () => {
    const parent = foreignKeys(codeReleaseMember).find(
      (key) => key.foreignTable === "code_release_member",
    );
    expect(parent).toEqual({
      columns: ["code_release_id", "parent_code_value_id"],
      foreignColumns: ["code_release_id", "code_value_id"],
      foreignTable: "code_release_member",
    });
  });

  test("상위가 자기 자신이면 만들 수 없다", () => {
    expect(checkExpression(codeReleaseMember, "code_release_member_parent_is_not_self"))
      .toContain("is distinct from");
  });

  test("release는 source_release와 기준일자·source version을 함께 갖는다", () => {
    const sealed = foreignKeys(codeRelease).find((key) => key.foreignTable === "source_release");
    expect(sealed?.columns).toEqual(["source_release_id"]);
    const nullability = columnNullability(codeRelease);
    expect(nullability.source_release_id).toBe(true);
    expect(nullability.code_scheme_id).toBe(true);
    expect(nullability.source_version).toBe(true);
    // 원본이 주지 않으면 기준일자는 null이다. not null이면 우리 실행 시각이 발표일로 읽힌다.
    expect(nullability.published_at).toBe(false);
  });

  test("승격 grain과 세 행 수가 release 안에 남는다", () => {
    expect(columnNames(codeRelease)).toEqual([
      "code_release_id",
      "source_release_id",
      "code_scheme_id",
      "source_version",
      "published_at",
      "promoted_grain",
      "source_row_count",
      "member_count",
      "excluded_row_count",
    ]);
    expect(checkExpression(codeRelease, "code_release_promoted_grain_present")).toContain("array_length");
  });

  test("승격 행과 제외 행의 합이 원본 행 수와 같아야 한다", () => {
    const expression = checkExpression(codeRelease, "code_release_row_counts_partition_source");
    expect(expression).toContain("member_count");
    expect(expression).toContain("excluded_row_count");
    expect(expression).toContain("source_row_count");
  });

  test("같은 봉인 입력의 같은 체계로 release를 두 번 만들지 않는다", () => {
    const uniques = getTableConfig(codeRelease).uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name),
    );
    expect(uniques).toContainEqual(["source_release_id", "code_scheme_id"]);
  });

  test("member의 유효기간은 없을 수 있고 순서가 뒤집히면 만들 수 없다", () => {
    const nullability = columnNullability(codeReleaseMember);
    expect(nullability.valid_from).toBe(false);
    expect(nullability.valid_to).toBe(false);
    expect(nullability.active).toBe(true);
    expect(checkExpression(codeReleaseMember, "code_release_member_valid_time_order")).toContain(">=");
  });

  test("id 열은 bigint이고 봉인 입력은 uuid다", () => {
    const types = columnSqlTypes(codeRelease);
    expect(types.code_release_id).toBe("bigint");
    expect(types.source_release_id).toBe("uuid");
    expect(columnSqlTypes(codeReleaseMember).parent_code_value_id).toBe("bigint");
  });
});
