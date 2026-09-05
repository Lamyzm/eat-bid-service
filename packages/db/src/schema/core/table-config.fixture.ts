/** @module 책임: core schema 계약 test가 Drizzle table config에서 열·제약을 읽는 접근자를 소유한다. */
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

type AnyPgTable = Parameters<typeof getTableConfig>[0];

export const columns = (table: AnyPgTable) => getTableConfig(table).columns;

export const columnNames = (table: AnyPgTable) => columns(table).map((column) => column.name);

export const columnNullability = (table: AnyPgTable) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.notNull]));

export const columnSqlTypes = (table: AnyPgTable) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.getSQLType()]));

export const uniqueColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name));

export const nullsNotDistinctUniqueColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).uniqueConstraints
    .filter((constraint) => constraint.nullsNotDistinct)
    .map((constraint) => constraint.columns.map((column) => column.name));

export const foreignKeyColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
    };
  });

export const checkNames = (table: AnyPgTable) => getTableConfig(table).checks.map((check) => check.name);

// 우리가 계산한 실효하한이나 승패를 관측 자리에 앉히지 못하게 막는 금지 어간이다(ADR 0033 §4-가).
export const forbiddenDerivedColumnStems = ["won", "invalid", "floor"] as const;

export const expectNoDerivedVerdictColumns = (table: AnyPgTable): string[] =>
  columnNames(table).filter((name) =>
    name.split("_").some((segment) => (forbiddenDerivedColumnStems as readonly string[]).includes(segment))
  );
