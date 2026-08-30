import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const schemaRoot = fileURLToPath(new URL("./", import.meta.url));

describe("검증 범위를 정의한다 — schema module layout", () => {
  test("보존 조건을 검증한다 — keeps ingest aggregates in focused modules", () => {
    for (const file of ["run.ts", "evidence.ts", "publication.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "ingest", file))).toBe(true);
    }
    expect(existsSync(path.join(schemaRoot, "ingest.ts"))).toBe(false);
  });

  test("보존 조건을 검증한다 — keeps core aggregates in focused modules", () => {
    for (const file of ["codes.ts", "organizations.ts", "procurement.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "core", file))).toBe(true);
    }

    for (const file of ["codes.ts", "organizations.ts", "procurement.ts"]) {
      expect(existsSync(path.join(schemaRoot, file))).toBe(false);
    }
  });

  test("사용 계약을 검증한다 — uses root and core indexes only to compose exports", async () => {
    const rootIndex = await readFile(path.join(schemaRoot, "index.ts"), "utf8");
    const coreIndex = await readFile(path.join(schemaRoot, "core", "index.ts"), "utf8");

    expect(rootIndex).not.toContain(".table(");
    expect(coreIndex).not.toContain(".table(");
  });
});
