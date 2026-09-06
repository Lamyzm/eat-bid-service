import { describe, expect, test } from "bun:test";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";

import { codeValueCoordinate } from "./code-coordinates";

type Table = Parameters<typeof getTableConfig>[0];

const columnSqlTypes = (table: Table) =>
  Object.fromEntries(getTableConfig(table).columns.map((column) => [column.name, column.getSQLType()]));

const columnNullability = (table: Table) =>
  Object.fromEntries(getTableConfig(table).columns.map((column) => [column.name, column.notNull]));

const checkExpression = (table: Table, name: string) => {
  const constraint = getTableConfig(table).checks.find((candidate) => candidate.name === name);
  if (constraint === undefined) throw new Error(`check constraint is missing: ${name}`);

  return new PgDialect().sqlToQuery(constraint.value).sql;
};

describe("코드 값 좌표 DDL", () => {
  test("위경도는 numeric이며 double precision이 아니다", () => {
    const types = columnSqlTypes(codeValueCoordinate);
    expect(types.latitude).toBe("numeric(9, 6)");
    expect(types.longitude).toBe("numeric(9, 6)");
    expect(types.latitude).not.toContain("double");
    expect(types.longitude).not.toContain("double");
  });

  test("CRS와 근거 observation은 없으면 행을 만들 수 없다", () => {
    const nullability = columnNullability(codeValueCoordinate);
    expect(nullability.crs).toBe(true);
    expect(nullability.evidence_observation_id).toBe(true);
    expect(nullability.code_release_id).toBe(true);
  });

  test("한 release 안에서 한 코드의 좌표는 하나다", () => {
    const uniques = getTableConfig(codeValueCoordinate).uniqueConstraints.map((constraint) =>
      constraint.columns.map((column) => column.name),
    );
    expect(uniques).toEqual([["code_release_id", "code_value_id"]]);
  });

  test("지구 밖 좌표와 다른 좌표계는 저장되지 않는다", () => {
    expect(checkExpression(codeValueCoordinate, "code_value_coordinate_within_earth"))
      .toContain("between -90 and 90");
    expect(checkExpression(codeValueCoordinate, "code_value_coordinate_crs_allowed"))
      .toContain("EPSG:4326");
  });

  test("좌표는 code_value·code_release·raw_observation을 모두 가리킨다", () => {
    const foreignTables = getTableConfig(codeValueCoordinate).foreignKeys.map(
      (foreignKey) => foreignKey.reference().foreignTable[Symbol.for("drizzle:Name")],
    );
    expect(new Set(foreignTables)).toEqual(new Set(["code_value", "code_release", "raw_observation"]));
  });
});
