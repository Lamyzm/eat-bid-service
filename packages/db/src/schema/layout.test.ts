import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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
});
