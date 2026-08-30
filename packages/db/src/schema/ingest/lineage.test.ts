import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";

import {
  normalizationAttempt,
  normalizationAttemptRecord,
  publicationRecord,
  replayInput,
} from "./lineage";

const tableName = Symbol.for("drizzle:Name");

function primaryKeyColumns(table: Parameters<typeof getTableConfig>[0]): string[][] {
  return getTableConfig(table).primaryKeys.map((key) =>
    key.columns.map((column) => column.name),
  );
}

function foreignKeys(table: Parameters<typeof getTableConfig>[0]) {
  return getTableConfig(table).foreignKeys.map((key) => {
    const reference = key.reference();
    return {
      columns: reference.columns.map((column) => column.name),
      foreignColumns: reference.foreignColumns.map((column) => column.name),
      foreignTable: reference.foreignTable[tableName],
    };
  });
}

function uniqueColumnSets(table: Parameters<typeof getTableConfig>[0]): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );
}

describe("ingest lineage manifest 계약", () => {
  test("parser 결과를 processing run과 observation grain에서 소유한다", () => {
    const config = getTableConfig(normalizationAttempt);

    expect(config.columns.map((column) => [column.name, column.notNull])).toEqual([
      ["normalization_attempt_id", true],
      ["run_id", true],
      ["observation_id", true],
      ["parser_version", true],
      ["status", true],
      ["attempted_at", true],
      ["schema_fingerprint", false],
      ["quarantine_reason", false],
    ]);
    expect(config.columns.map((column) => column.getSQLType())).toEqual([
      "bigint",
      "uuid",
      "bigint",
      "varchar(128)",
      "varchar(16)",
      "timestamp with time zone",
      "char(64)",
      "text",
    ]);
    expect(config.columns[0]?.primary).toBe(true);
    expect(uniqueColumnSets(normalizationAttempt)).toContainEqual([
      "run_id",
      "observation_id",
      "parser_version",
    ]);
    expect(config.columns.find((column) => column.name === "status")?.enumValues).toEqual([
      "normalized",
      "quarantined",
    ]);
    expect(config.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "normalization_attempt_status_allowed",
      "normalization_attempt_final_metadata",
      "normalization_attempt_schema_fingerprint_sha256",
      "normalization_attempt_quarantine_reason_bounded",
    ]));
    expect(foreignKeys(normalizationAttempt)).toEqual([
      {
        columns: ["run_id"],
        foreignColumns: ["run_id"],
        foreignTable: "run",
      },
      {
        columns: ["observation_id"],
        foreignColumns: ["observation_id"],
        foreignTable: "raw_observation",
      },
    ]);
  });

  test("각 최종 normalized attempt를 재사용 가능한 normalized record에 연결한다", () => {
    const columns = getTableConfig(normalizationAttemptRecord).columns;

    expect(columns.map((column) => [column.name, column.notNull])).toEqual([
      ["normalization_attempt_id", true],
      ["normalized_record_id", true],
    ]);
    expect(primaryKeyColumns(normalizationAttemptRecord)).toEqual([
      ["normalization_attempt_id", "normalized_record_id"],
    ]);
    expect(uniqueColumnSets(normalizationAttemptRecord)).toHaveLength(0);
    expect(foreignKeys(normalizationAttemptRecord)).toEqual([
      {
        columns: ["normalization_attempt_id"],
        foreignColumns: ["normalization_attempt_id"],
        foreignTable: "normalization_attempt",
      },
      {
        columns: ["normalized_record_id"],
        foreignColumns: ["normalized_record_id"],
        foreignTable: "normalized_record",
      },
    ]);
  });

  test("publication membership을 publication과 normalized record grain으로 고정한다", () => {
    const columns = getTableConfig(publicationRecord).columns;

    expect(columns.map((column) => [column.name, column.notNull])).toEqual([
      ["publication_id", true],
      ["normalized_record_id", true],
    ]);
    expect(columns.map((column) => column.getSQLType())).toEqual(["uuid", "bigint"]);
    expect(primaryKeyColumns(publicationRecord)).toEqual([
      ["publication_id", "normalized_record_id"],
    ]);
    expect(getTableConfig(publicationRecord).uniqueConstraints).toHaveLength(0);
    expect(foreignKeys(publicationRecord)).toEqual([
      {
        columns: ["publication_id"],
        foreignColumns: ["publication_id"],
        foreignTable: "publication",
      },
      {
        columns: ["normalized_record_id"],
        foreignColumns: ["normalized_record_id"],
        foreignTable: "normalized_record",
      },
    ]);
  });

  test("명시적인 replay run membership으로 불변 observation을 재사용한다", () => {
    const columns = getTableConfig(replayInput).columns;

    expect(columns.map((column) => [column.name, column.notNull])).toEqual([
      ["run_id", true],
      ["observation_id", true],
    ]);
    expect(columns.map((column) => column.getSQLType())).toEqual(["uuid", "bigint"]);
    expect(primaryKeyColumns(replayInput)).toEqual([["run_id", "observation_id"]]);
    expect(getTableConfig(replayInput).uniqueConstraints).toHaveLength(0);
    expect(foreignKeys(replayInput)).toEqual([
      {
        columns: ["run_id"],
        foreignColumns: ["run_id"],
        foreignTable: "run",
      },
      {
        columns: ["observation_id"],
        foreignColumns: ["observation_id"],
        foreignTable: "raw_observation",
      },
    ]);
  });
});
