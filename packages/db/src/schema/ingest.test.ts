import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ingestRun,
  normalizedRecord,
  normalizationAttempt,
  normalizationAttemptRecord,
  publication,
  publicationRecord,
  rawBlob,
  rawObservation,
  replayInput,
  requestUnit,
} from "./ingest/index";

const columnNames = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).columns.map((column) => column.name);

const uniqueColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name),
  );

const foreignKeyColumnSets = (table: Parameters<typeof getTableConfig>[0]) =>
  getTableConfig(table).foreignKeys.map((foreignKey) => ({
    columns: foreignKey.reference().columns.map((column) => column.name),
    foreignTable: foreignKey.reference().foreignTable[Symbol.for("drizzle:Name")],
  }));

describe("ingest identity 불변식", () => {
  test("ID·count·byte·HTTP status bigint 열을 모두 bigint TypeScript mapping으로 선언한다", () => {
    for (const table of [
      ingestRun,
      requestUnit,
      rawBlob,
      rawObservation,
      normalizedRecord,
      publication,
      normalizationAttempt,
      normalizationAttemptRecord,
      publicationRecord,
      replayInput,
    ]) {
      for (const column of getTableConfig(table).columns.filter((candidate) => candidate.getSQLType() === "bigint")) {
        expect(column.dataType, `${column.name} must declare bigint int64`).toBe("bigint int64");
        expect(column.columnType, `${column.name} must use PgBigInt64`).toBe("PgBigInt64");
      }
    }
    const status = getTableConfig(rawObservation).columns.find((column) => column.name === "http_status");
    expect(status).toMatchObject({ dataType: "bigint int64", columnType: "PgBigInt64" });
  });

  test("불변 blob만 중복 제거하고 observation은 합치지 않는다", () => {
    const blob = getTableConfig(rawBlob);
    const observation = getTableConfig(rawObservation);

    expect(blob.columns.find((column) => column.name === "content_sha256")?.primary).toBe(true);
    expect(blob.columns.find((column) => column.name === "content_sha256")?.getSQLType()).toBe("char(64)");
    expect(observation.columns.find((column) => column.name === "observation_id")?.primary).toBe(true);
    expect(uniqueColumnSets(rawObservation)).not.toContainEqual([
      "run_id",
      "request_unit_id",
      "content_sha256",
    ]);
  });

  test("request_unit.attempt_count는 재시도 없는 요청을 1로 두는 not null integer다", () => {
    const attemptCount = getTableConfig(requestUnit).columns.find(
      (column) => column.name === "attempt_count",
    );

    expect(attemptCount?.getSQLType()).toBe("integer");
    expect(attemptCount?.notNull).toBe(true);
    expect(attemptCount?.default).toBe(1);
  });

  test("run.build_sha는 40자 release commit을 패딩 없이 담는 varchar다", () => {
    const buildSha = getTableConfig(ingestRun).columns.find((column) => column.name === "build_sha");

    expect(buildSha?.getSQLType()).toBe("varchar(64)");
    expect(buildSha?.notNull).toBe(true);
  });

  test("각 table을 요구된 evidence grain으로 유지한다", () => {
    expect(columnNames(ingestRun)).toEqual(expect.arrayContaining([
      "run_id",
      "mode",
      "status",
      "build_sha",
      "parser_version",
      "workflow_name",
      "started_at",
      "ended_at",
      "failure_category",
      "expected_count",
      "captured_count",
      "published_count",
    ]));
    expect(columnNames(requestUnit)).toEqual(expect.arrayContaining([
      "request_unit_id",
      "run_id",
      "source",
      "endpoint",
      "request_params",
      "request_params_hash",
      "expected_count",
      "observed_count",
      "attempt_count",
      "status",
    ]));
    expect(columnNames(rawBlob)).toEqual(expect.arrayContaining([
      "content_sha256",
      "object_key",
      "byte_length",
      "content_type",
      "content_encoding",
      "stored_at",
    ]));
    expect(columnNames(rawObservation)).toEqual([
      "observation_id",
      "run_id",
      "request_unit_id",
      "source",
      "endpoint",
      "request_params",
      "fetched_at",
      "http_status",
      "content_sha256",
    ]);
    expect(columnNames(normalizedRecord)).toEqual(expect.arrayContaining([
      "normalized_record_id",
      "observation_id",
      "record_type",
      "source_entity_id",
      "normalized_payload",
      "parser_version",
      "normalized_at",
    ]));
    expect(columnNames(publication)).toEqual(expect.arrayContaining([
      "publication_id",
      "run_id",
      "status",
      "validated_at",
      "activated_at",
      "expected_count",
      "normalized_count",
      "published_count",
      "canonical_fingerprint",
      "projector_version",
    ]));
  });

  test("run·request·normalized record·publication identity를 강제한다", () => {
    expect(uniqueColumnSets(requestUnit)).toContainEqual([
      "run_id",
      "source",
      "endpoint",
      "request_params_hash",
    ]);
    expect(uniqueColumnSets(normalizedRecord)).toContainEqual([
      "observation_id",
      "record_type",
      "source_entity_id",
      "parser_version",
    ]);
    expect(uniqueColumnSets(publication)).toContainEqual(["run_id"]);
    expect(getTableConfig(rawBlob).uniqueConstraints.map((constraint) => constraint.columns.map((column) => column.name)))
      .toContainEqual(["object_key"]);
  });

  test("observation의 request unit을 같은 run에 묶는다", () => {
    expect(uniqueColumnSets(requestUnit)).toContainEqual(["request_unit_id", "run_id"]);

    const coherentRequestForeignKey = getTableConfig(rawObservation).foreignKeys.find((foreignKey) => {
      const reference = foreignKey.reference();

      return reference.foreignTable[Symbol.for("drizzle:Name")] === "request_unit"
        && reference.columns.map((column) => column.name).join(",") === "request_unit_id,run_id"
        && reference.foreignColumns.map((column) => column.name).join(",") === "request_unit_id,run_id";
    });

    expect(coherentRequestForeignKey).toBeDefined();
  });

  test("raw evidence와 gate를 통과한 publication 관계를 요구한다", () => {
    expect(foreignKeyColumnSets(requestUnit)).toContainEqual({ columns: ["run_id"], foreignTable: "run" });
    expect(foreignKeyColumnSets(rawObservation)).toEqual(expect.arrayContaining([
      { columns: ["run_id"], foreignTable: "run" },
      { columns: ["request_unit_id"], foreignTable: "request_unit" },
      { columns: ["content_sha256"], foreignTable: "raw_blob" },
    ]));
    expect(foreignKeyColumnSets(normalizedRecord)).toContainEqual({
      columns: ["observation_id"],
      foreignTable: "raw_observation",
    });
    expect(foreignKeyColumnSets(publication)).toContainEqual({ columns: ["run_id"], foreignTable: "run" });
  });

  test("timezone-aware timestamp와 정확한 run·parser state를 사용한다", () => {
    for (const table of [ingestRun, rawBlob, rawObservation, normalizedRecord, publication]) {
      for (const column of getTableConfig(table).columns.filter((column) => column.name.endsWith("_at"))) {
        expect(column.getSQLType()).toBe("timestamp with time zone");
      }
    }

    expect(getTableConfig(ingestRun).columns.find((column) => column.name === "status")?.enumValues)
      .toEqual(["planned", "running", "failed", "validated", "published"]);
  });

  test("모든 count의 음수를 막고 publication state를 gate에 묶는다", () => {
    const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).checks.map((constraint) => constraint.name);

    expect(checkNames(ingestRun)).toEqual(expect.arrayContaining([
      "run_status_allowed",
      "run_expected_count_nonnegative",
      "run_captured_count_nonnegative",
      "run_published_count_nonnegative",
      "run_end_chronology",
      "run_terminal_metadata",
      "run_published_count_matches_expected",
    ]));
    expect(checkNames(requestUnit)).toEqual(expect.arrayContaining([
      "request_unit_expected_count_nonnegative",
      "request_unit_observed_count_nonnegative",
      "request_unit_attempt_count_positive",
    ]));
    expect(checkNames(rawBlob)).toContain("raw_blob_byte_length_nonnegative");
    expect(checkNames(publication)).toEqual(expect.arrayContaining([
      "publication_status_allowed",
      "publication_expected_count_nonnegative",
      "publication_normalized_count_nonnegative",
      "publication_published_count_nonnegative",
      "publication_activation_chronology",
      "publication_validated_requires_validation_timestamp",
      "publication_canonical_fingerprint_sha256",
      "publication_projector_version_nonempty",
      "publication_nonpublished_metadata_empty",
      "publication_published_requires_gate",
    ]));
  });
});
