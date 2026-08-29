import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const schemaRoot = fileURLToPath(new URL("./", import.meta.url));

describe("schema module layout", () => {
  test("keeps ingest aggregates in focused modules", () => {
    for (const file of ["run.ts", "evidence.ts", "publication.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "ingest", file))).toBe(true);
    }
    expect(existsSync(path.join(schemaRoot, "ingest.ts"))).toBe(false);
  });

  test("keeps core aggregates in focused modules", () => {
    for (const file of ["codes.ts", "organizations.ts", "procurement.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "core", file))).toBe(true);
    }

    for (const file of ["codes.ts", "organizations.ts", "procurement.ts"]) {
      expect(existsSync(path.join(schemaRoot, file))).toBe(false);
    }
  });

  test("uses root and core indexes only to compose exports", async () => {
    const rootIndex = await readFile(path.join(schemaRoot, "index.ts"), "utf8");
    const coreIndex = await readFile(path.join(schemaRoot, "core", "index.ts"), "utf8");

    expect(rootIndex).not.toContain(".table(");
    expect(coreIndex).not.toContain(".table(");
  });
});
