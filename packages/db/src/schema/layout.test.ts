import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const schemaRoot = fileURLToPath(new URL("./", import.meta.url));

describe("schema module 배치", () => {
  test("ingest aggregate를 역할별 module에 둔다", () => {
    for (const file of ["run.ts", "evidence.ts", "publication.ts", "index.ts"]) {
      expect(existsSync(path.join(schemaRoot, "ingest", file))).toBe(true);
    }
    expect(existsSync(path.join(schemaRoot, "ingest.ts"))).toBe(false);
  });

  test("core aggregate를 역할별 module에 둔다", () => {
    for (const file of [
      "codes.ts",
      "organizations.ts",
      "procurement.ts",
      "suppliers.ts",
      "bidding.ts",
      "index.ts",
    ]) {
      expect(existsSync(path.join(schemaRoot, "core", file))).toBe(true);
    }

    for (const file of ["codes.ts", "organizations.ts", "procurement.ts", "suppliers.ts", "bidding.ts"]) {
      expect(existsSync(path.join(schemaRoot, file))).toBe(false);
    }
  });

  test("mart aggregate를 빌드 원장과 표별 module로 나눈다", () => {
    for (const file of [
      "build.ts",
      "values.ts",
      "coverage.ts",
      "round-summary.ts",
      "win-rate-distribution.ts",
      "open-auction-snapshot.ts",
      "index.ts",
    ]) {
      expect(existsSync(path.join(schemaRoot, "mart", file))).toBe(true);
    }
    expect(existsSync(path.join(schemaRoot, "mart.ts"))).toBe(false);
  });

  test("root·core index는 export 조립에만 사용한다", async () => {
    const rootIndex = await readFile(path.join(schemaRoot, "index.ts"), "utf8");
    const coreIndex = await readFile(path.join(schemaRoot, "core", "index.ts"), "utf8");

    expect(rootIndex).not.toContain(".table(");
    expect(coreIndex).not.toContain(".table(");
  });
});
