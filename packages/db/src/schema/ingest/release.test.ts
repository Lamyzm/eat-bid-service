import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";

import {
  sourceRelease,
  sourceReleaseDataset,
  sourceReleaseObservation,
  sourceReleaseRun,
} from "../index";

const tableName = Symbol.for("drizzle:Name");
const dialect = new PgDialect();

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

function checkSql(table: Parameters<typeof getTableConfig>[0], name: string): string {
  const constraint = getTableConfig(table).checks.find((check) => check.name === name);
  if (!constraint) {
    throw new Error(`Missing check constraint: ${name}`);
  }

  return dialect.sqlToQuery(constraint.value).sql;
}

describe("source release manifest DDL 불변식", () => {
  test("source release는 실행과 observation membership을 따로 소유한다", () => {
    expect(getTableName(sourceRelease)).toBe("source_release");
    expect(getTableName(sourceReleaseRun)).toBe("source_release_run");
    expect(getTableName(sourceReleaseObservation)).toBe("source_release_observation");
    expect(getTableName(sourceReleaseDataset)).toBe("source_release_dataset");

    expect(primaryKeyColumns(sourceReleaseRun)).toEqual([["source_release_id", "run_id"]]);
    expect(primaryKeyColumns(sourceReleaseObservation)).toEqual([
      ["source_release_id", "observation_id"],
    ]);
    expect(foreignKeys(sourceReleaseRun)).toEqual([
      {
        columns: ["source_release_id"],
        foreignColumns: ["source_release_id"],
        foreignTable: "source_release",
      },
      {
        columns: ["run_id"],
        foreignColumns: ["run_id"],
        foreignTable: "run",
      },
    ]);
    expect(foreignKeys(sourceReleaseObservation)).toEqual([
      {
        columns: ["source_release_id"],
        foreignColumns: ["source_release_id"],
        foreignTable: "source_release",
      },
      {
        columns: ["observation_id"],
        foreignColumns: ["observation_id"],
        foreignTable: "raw_observation",
      },
    ]);
  });

  test("sealed release와 dataset manifest에 필요한 상태와 provenance를 선언한다", () => {
    const release = getTableConfig(sourceRelease);
    const dataset = getTableConfig(sourceReleaseDataset);

    expect(release.columns.map((column) => [column.name, column.getSQLType(), column.notNull])).toEqual([
      ["source_release_id", "uuid", true],
      ["source", "varchar(64)", true],
      ["release_name", "varchar(128)", true],
      ["status", "varchar(16)", true],
      ["as_of", "timestamp with time zone", true],
      ["manifest_sha256", "char(64)", false],
      ["sealed_at", "timestamp with time zone", false],
      ["failure_category", "varchar(64)", false],
    ]);
    expect(release.columns.find((column) => column.name === "status")?.enumValues).toEqual([
      "planned",
      "sealed",
      "failed",
    ]);
    expect(release.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "source_release_status_allowed",
      "source_release_manifest_sha256",
      "source_release_terminal_metadata",
    ]));
    const terminalMetadataSql = checkSql(sourceRelease, "source_release_terminal_metadata");
    expect(terminalMetadataSql).toContain(`"status" = 'sealed'`);
    expect(terminalMetadataSql).toContain(`"manifest_sha256" is not null`);
    expect(terminalMetadataSql).toContain(`"sealed_at" is not null`);
    expect(terminalMetadataSql).toContain(`"status" = 'failed'`);
    expect(terminalMetadataSql).toContain(`"manifest_sha256" is null`);
    expect(terminalMetadataSql).toContain(`"failure_category" is not null`);

    expect(dataset.columns.map((column) => [column.name, column.getSQLType(), column.notNull])).toEqual([
      ["source_release_id", "uuid", true],
      ["endpoint", "text", true],
      ["dataset", "varchar(128)", true],
      ["record_type", "varchar(64)", true],
      ["parser_version", "varchar(128)", true],
      ["schema_fingerprint", "char(64)", true],
      ["expected_count", "bigint", true],
      ["observed_count", "bigint", true],
      ["normalized_count", "bigint", true],
      ["quarantined_count", "bigint", true],
      ["required", "boolean", true],
    ]);
    expect(primaryKeyColumns(sourceReleaseDataset)).toEqual([["source_release_id", "dataset"]]);
    expect(foreignKeys(sourceReleaseDataset)).toEqual([
      {
        columns: ["source_release_id"],
        foreignColumns: ["source_release_id"],
        foreignTable: "source_release",
      },
    ]);
    expect(dataset.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "source_release_dataset_schema_fingerprint_sha256",
      "source_release_dataset_expected_count_nonnegative",
      "source_release_dataset_observed_count_nonnegative",
      "source_release_dataset_normalized_count_nonnegative",
      "source_release_dataset_quarantined_count_nonnegative",
    ]));
    expect(checkSql(sourceReleaseDataset, "source_release_dataset_schema_fingerprint_sha256"))
      .toContain(`"schema_fingerprint" ~ '^[0-9a-f]{64}$'`);
  });
});
