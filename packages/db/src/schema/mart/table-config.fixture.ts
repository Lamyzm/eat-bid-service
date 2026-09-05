/** @module 책임: mart schema 계약 test가 Drizzle table config와 커밋된 migration SQL을 읽는 접근자를 소유한다. */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";

type AnyPgTable = Parameters<typeof getTableConfig>[0];

export const columns = (table: AnyPgTable) => getTableConfig(table).columns;

export const columnNames = (table: AnyPgTable) => columns(table).map((column) => column.name);

export const columnSqlTypes = (table: AnyPgTable) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.getSQLType()]));

export const columnNullability = (table: AnyPgTable) =>
  Object.fromEntries(columns(table).map((column) => [column.name, column.notNull]));

export const uniqueColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name));

export const nullsNotDistinctUniqueColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).uniqueConstraints
    .filter((constraint) => constraint.nullsNotDistinct)
    .map((constraint) => constraint.columns.map((column) => column.name));

export const indexNames = (table: AnyPgTable) =>
  getTableConfig(table).indexes.map((index) => index.config.name);

export const indexColumnNames = (table: AnyPgTable, name: string) =>
  getTableConfig(table)
    .indexes.find((index) => index.config.name === name)
    ?.config.columns.map((column) => ("name" in column ? column.name : String(column)));

export const checkNames = (table: AnyPgTable) => getTableConfig(table).checks.map((check) => check.name);

export const foreignKeyColumnSets = (table: AnyPgTable) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => {
    const reference = foreignKey.reference();

    return {
      columns: reference.columns.map((column) => column.name),
      foreignTable: getTableName(reference.foreignTable),
    };
  });

/**
 * mart는 파생값이 사는 자리이므로 core의 `expectNoDerivedVerdictColumns` 금지 어간을 그대로 쓰지
 * 않는다. 그날 하한과 하한 미만 수는 여기서 정당한 열이다. 대신 승패·무효 어간은 여기서도 금지다 —
 * 원본 `BID_STT` 밖에서 우리가 유효를 판정하지 않는다(PDR-0002, AGENTS 8).
 */
export const forbiddenMartColumnStems = ["won", "invalid", "valid", "predicted", "recommended"] as const;

export const forbiddenMartColumns = (table: AnyPgTable): string[] =>
  columnNames(table).filter((name) =>
    name.split("_").some((segment) => (forbiddenMartColumnStems as readonly string[]).includes(segment))
  );

const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../drizzle");

export const migrationSql = (folder: string): string =>
  readFileSync(join(migrationRoot, folder, "migration.sql"), "utf8");

export const migrationFolders = (): string[] =>
  readdirSync(migrationRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

export const allMigrationSql = (): string =>
  migrationFolders().map((folder) => migrationSql(folder)).join("\n");
