import { describe, expect, test } from "bun:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  ingestRun,
  normalizedRecord,
  publication,
  rawBlob,
  rawObservation,
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

describe("ingest identity", () => {
  test("deduplicates immutable blobs but never observations", () => {
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

  test("keeps each table at its required evidence grain", () => {
    expect(columnNames(ingestRun)).toEqual(expect.arrayContaining([
      "run_id",
      "mode",
      "status",
      "build_sha",
      "parser_version",
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
    expect(columnNames(rawObservation)).toEqual(expect.arrayContaining([
      "observation_id",
      "run_id",
      "request_unit_id",
      "source",
      "endpoint",
      "request_params",
      "fetched_at",
      "http_status",
      "content_sha256",
      "source_entity_id",
      "schema_fingerprint",
      "parser_status",
      "quarantine_reason",
    ]));
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
    ]));
  });

  test("enforces run, request, normalized-record, and publication identities", () => {
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

  test("binds an observation request unit to the observation run", () => {
    expect(uniqueColumnSets(requestUnit)).toContainEqual(["request_unit_id", "run_id"]);

    const coherentRequestForeignKey = getTableConfig(rawObservation).foreignKeys.find((foreignKey) => {
      const reference = foreignKey.reference();

      return reference.foreignTable[Symbol.for("drizzle:Name")] === "request_unit"
        && reference.columns.map((column) => column.name).join(",") === "request_unit_id,run_id"
        && reference.foreignColumns.map((column) => column.name).join(",") === "request_unit_id,run_id";
    });

    expect(coherentRequestForeignKey).toBeDefined();
  });

  test("requires raw evidence and gated publication relationships", () => {
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

  test("uses timezone-aware timestamps and exact run and parser states", () => {
    for (const table of [ingestRun, rawBlob, rawObservation, normalizedRecord, publication]) {
      for (const column of getTableConfig(table).columns.filter((column) => column.name.endsWith("_at"))) {
        expect(column.getSQLType()).toBe("timestamp with time zone");
      }
    }

    expect(getTableConfig(ingestRun).columns.find((column) => column.name === "status")?.enumValues)
      .toEqual(["planned", "running", "failed", "validated", "published"]);
    expect(getTableConfig(rawObservation).columns.find((column) => column.name === "parser_status")?.enumValues)
      .toEqual(["pending", "normalized", "quarantined"]);
  });

  test("protects every count from negatives and ties publication state to its gate", () => {
    const checkNames = (table: Parameters<typeof getTableConfig>[0]) =>
      getTableConfig(table).checks.map((constraint) => constraint.name);

    expect(checkNames(ingestRun)).toEqual(expect.arrayContaining([
      "run_status_allowed",
      "run_expected_count_nonnegative",
      "run_captured_count_nonnegative",
      "run_published_count_nonnegative",
    ]));
    expect(checkNames(requestUnit)).toEqual(expect.arrayContaining([
      "request_unit_expected_count_nonnegative",
      "request_unit_observed_count_nonnegative",
    ]));
    expect(checkNames(rawBlob)).toContain("raw_blob_byte_length_nonnegative");
    expect(checkNames(rawObservation)).toContain("raw_observation_parser_status_allowed");
    expect(checkNames(publication)).toEqual(expect.arrayContaining([
      "publication_status_allowed",
      "publication_expected_count_nonnegative",
      "publication_normalized_count_nonnegative",
      "publication_published_count_nonnegative",
      "publication_validated_requires_validation_timestamp",
      "publication_published_requires_gate",
    ]));
  });
});
