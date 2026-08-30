import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];

afterAll(async () => {
  await Promise.all(temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

function expectRecursivelySorted(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) expectRecursivelySorted(item);
    return;
  }
  if (value === null || typeof value !== "object") return;

  const keys = Object.keys(value);
  expect(keys).toEqual([...keys].sort());
  for (const item of Object.values(value)) expectRecursivelySorted(item);
}

describe("portable 계약 registry와 JSON Schema emitter", () => {
  test("registry의 안정 ID는 중복되지 않고 schema metadata와 일치한다", async () => {
    const registry = await import("./portable-registry").catch(() => undefined);
    expect(registry, "portable registry가 존재해야 한다").toBeDefined();

    const ids = registry!.portableContracts.map((entry) => entry.id);
    expect(ids).toEqual(["EatbidIngestionAuctionV1"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of registry!.portableContracts) {
      expect(entry.schema.meta()?.id).toBe(entry.id);
    }
    expect(Object.isFrozen(registry!.portableContracts)).toBe(true);
  });

  test("두 번 생성한 root schema는 재귀 정렬된 동일 bytes이며 LF 하나로 끝난다", async () => {
    const emitter = await import("./generate-json-schema").catch(() => undefined);
    expect(emitter, "JSON Schema emitter가 존재해야 한다").toBeDefined();

    const firstDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-first-"));
    const secondDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-second-"));
    temporaryDirectories.push(firstDirectory, secondDirectory);

    const [firstPath, secondPath] = await Promise.all([
      emitter!.emitIngestionV1Schema(firstDirectory),
      emitter!.emitIngestionV1Schema(secondDirectory),
    ]);
    const [first, second] = await Promise.all([readFile(firstPath), readFile(secondPath)]);

    expect(first.equals(second)).toBe(true);
    const text = first.toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    const document = JSON.parse(text);
    expect(document.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(document.$id).toBe("EatbidIngestionAuctionV1");
    expectRecursivelySorted(document);
  });

  test("check mode는 임시 생성물과 비교하고 추적 artifact를 다시 쓰지 않는다", async () => {
    const { checkIngestionV1Schema, ingestionV1SchemaPath } = await import("./generate-json-schema");
    const beforeBytes = await readFile(ingestionV1SchemaPath);
    const beforeStat = await stat(ingestionV1SchemaPath);

    await checkIngestionV1Schema();

    const afterBytes = await readFile(ingestionV1SchemaPath);
    const afterStat = await stat(ingestionV1SchemaPath);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  test("생성 artifact가 drift하면 check mode가 실패하고 기존 bytes를 보존한다", async () => {
    const { checkIngestionV1Schema } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-drift-"));
    temporaryDirectories.push(directory);
    const driftedPath = join(directory, "ingestion-v1.schema.json");
    const drifted = Buffer.from("{\"drifted\":true}\n", "utf8");
    await writeFile(driftedPath, drifted);

    await expect(checkIngestionV1Schema(driftedPath)).rejects.toThrow("Generated JSON Schema differs");
    expect((await readFile(driftedPath)).equals(drifted)).toBe(true);
  });
});
