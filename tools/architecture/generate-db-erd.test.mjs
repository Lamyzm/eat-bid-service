import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { erdFileName, latestSnapshot, mermaidType, renderSchemaErd } from "./generate-db-erd.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const generator = path.join(root, "tools", "architecture", "generate-db-erd.mjs");

const snapshot = {
  version: "8",
  ddl: [
    { name: "core", entityType: "schemas" },
    { name: "ingest", entityType: "schemas" },
    { name: "run", entityType: "tables", schema: "ingest" },
    { name: "auction_attempt", entityType: "tables", schema: "core" },
    { name: "auction_revision", entityType: "tables", schema: "core" },
    { name: "run_id", type: "uuid", notNull: true, dimensions: 0, entityType: "columns", schema: "ingest", table: "run" },
    { name: "auction_attempt_id", type: "bigint", dimensions: 0, entityType: "columns", schema: "core", table: "auction_attempt" },
    { name: "external_bid_id", type: "character varying(64)", dimensions: 0, entityType: "columns", schema: "core", table: "auction_attempt" },
    { name: "auction_revision_id", type: "bigint", dimensions: 0, entityType: "columns", schema: "core", table: "auction_revision" },
    { name: "auction_attempt_id", type: "bigint", dimensions: 0, entityType: "columns", schema: "core", table: "auction_revision" },
    { name: "run_id", type: "uuid", dimensions: 0, entityType: "columns", schema: "core", table: "auction_revision" },
    { name: "tags", type: "text", dimensions: 1, entityType: "columns", schema: "core", table: "auction_revision" },
    { name: "observed_at", type: "timestamp with time zone", dimensions: 0, entityType: "columns", schema: "core", table: "auction_revision" },
    { columns: ["auction_attempt_id"], name: "auction_attempt_pkey", entityType: "pks", schema: "core", table: "auction_attempt" },
    { columns: ["auction_revision_id"], name: "auction_revision_pkey", entityType: "pks", schema: "core", table: "auction_revision" },
    { columns: ["external_bid_id"], name: "auction_attempt_external_key", entityType: "uniques", schema: "core", table: "auction_attempt" },
    {
      columns: ["auction_attempt_id"],
      schemaTo: "core",
      tableTo: "auction_attempt",
      columnsTo: ["auction_attempt_id"],
      name: "auction_revision_attempt_fkey",
      entityType: "fks",
      schema: "core",
      table: "auction_revision",
    },
    {
      columns: ["run_id"],
      schemaTo: "ingest",
      tableTo: "run",
      columnsTo: ["run_id"],
      name: "auction_revision_run_fkey",
      entityType: "fks",
      schema: "core",
      table: "auction_revision",
    },
  ],
};

test("mermaid 타입은 공백·괄호를 식별자로 바꾸고 배열 차원을 접미사로 남긴다", () => {
  assert.equal(mermaidType("timestamp with time zone"), "timestamptz");
  assert.equal(mermaidType("character varying(64)"), "varchar_64");
  assert.equal(mermaidType("numeric(20, 4)"), "numeric_20_4");
  assert.equal(mermaidType("text", 1), "text_array");
  assert.equal(mermaidType("text[]"), "text_array");
  assert.equal(mermaidType(""), "unknown");
});

test("스키마 ERD는 표·컬럼·키 표시와 다른 스키마를 가리키는 관계선을 결정적으로 낸다", () => {
  const core = renderSchemaErd(snapshot, "core", { folder: "20260101000000_fixture" });

  assert.match(core, /^# `core` 스키마 ERD$/mu);
  assert.match(core, /packages\/db\/drizzle\/20260101000000_fixture\/snapshot\.json/u);
  assert.match(core, /^    auction_attempt \{$/mu);
  assert.match(core, /^        bigint auction_attempt_id PK$/mu);
  assert.match(core, /^        varchar_64 external_bid_id UK$/mu);
  assert.match(core, /^        bigint auction_attempt_id FK$/mu);
  assert.match(core, /^        text_array tags$/mu);
  assert.match(core, /^        timestamptz observed_at$/mu);
  assert.match(core, /^    auction_attempt \|\|--o\{ auction_revision : "auction_attempt_id"$/mu);
  assert.match(core, /^    ingest__run \|\|--o\{ auction_revision : "run_id"$/mu);
  assert.doesNotMatch(core, /^    run \{$/mu);

  const ingest = renderSchemaErd(snapshot, "ingest", { folder: "20260101000000_fixture" });
  assert.match(ingest, /^        uuid run_id$/mu);
  assert.match(ingest, /^    run \|\|--o\{ core__auction_revision : "run_id"$/mu);
  assert.equal(renderSchemaErd(snapshot, "core", { folder: "x" }), renderSchemaErd(snapshot, "core", { folder: "x" }));
});

function withFixtureRoot(run) {
  const directory = mkdtempSync(path.join(tmpdir(), "eatbid-erd-"));
  try {
    const older = path.join(directory, "packages", "db", "drizzle", "20260101000000_older");
    const newer = path.join(directory, "packages", "db", "drizzle", "20260102000000_newer");
    mkdirSync(older, { recursive: true });
    mkdirSync(newer, { recursive: true });
    writeFileSync(path.join(older, "snapshot.json"), JSON.stringify({ ddl: [{ name: "core", entityType: "schemas" }] }), "utf8");
    writeFileSync(path.join(newer, "snapshot.json"), JSON.stringify(snapshot), "utf8");
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

function runGenerator(directory, flag) {
  return spawnSync(process.execPath, [generator, flag], {
    encoding: "utf8",
    env: { ...process.env, DB_ERD_ROOT: directory },
  });
}

test("--write는 사전순 마지막 snapshot으로 스키마별 파일을 쓰고 --check는 drift와 원천 없는 파일을 실패시킨다", () => {
  withFixtureRoot((directory) => {
    assert.equal(latestSnapshot(path.join(directory, "packages", "db", "drizzle")).folder, "20260102000000_newer");

    const written = runGenerator(directory, "--write");
    assert.equal(written.status, 0, written.stderr);
    const generated = path.join(directory, "docs", "architecture", "generated");
    const core = readFileSync(path.join(generated, erdFileName("core")), "utf8");
    assert.match(core, /20260102000000_newer/u);
    assert.match(core, /auction_attempt \|\|--o\{ auction_revision/u);

    const clean = runGenerator(directory, "--check");
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /검사가 통과했습니다/u);

    writeFileSync(path.join(generated, erdFileName("core")), `${core}\n손으로 고친 줄\n`, "utf8");
    writeFileSync(path.join(generated, "erd-legacy.md"), "# 옛 스키마\n", "utf8");
    const drift = runGenerator(directory, "--check");
    assert.equal(drift.status, 1);
    assert.match(drift.stderr, /erd-core\.md/u);
    assert.match(drift.stderr, /erd-legacy\.md/u);
    assert.match(drift.stderr, /architecture:erd:write/u);

    const usage = runGenerator(directory, "--nothing");
    assert.equal(usage.status, 2);
  });
});

test("추적된 ERD 생성물은 실제 snapshot과 같다", () => {
  const output = execFileSync(process.execPath, [generator, "--check"], { cwd: root, encoding: "utf8" });
  assert.match(output, /스키마 4개/u);
});
