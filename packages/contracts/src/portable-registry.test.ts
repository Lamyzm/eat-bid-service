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
    expect(ids).toEqual(["EatbidIngestionAuctionV1", "EatbidIngestionAuctionV2"]);
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
      emitter!.emitPortableSchema("EatbidIngestionAuctionV1", firstDirectory),
      emitter!.emitPortableSchema("EatbidIngestionAuctionV1", secondDirectory),
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

  test("계약마다 artifact 파일명이 다르고 v2도 재귀 정렬된 동일 bytes로 생성된다", async () => {
    const { emitPortableSchemas } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-v2-"));
    temporaryDirectories.push(directory);

    const paths = await emitPortableSchemas(directory);
    expect(paths.map((path) => path.split(/[\\/]/).at(-1))).toEqual([
      "ingestion-v1.schema.json",
      "ingestion-v2.schema.json",
    ]);
    const document = JSON.parse(await readFile(paths[1]!, "utf8"));
    expect(document.$id).toBe("EatbidIngestionAuctionV2");
    expectRecursivelySorted(document);
  });

  test("check mode는 등록된 계약 artifact를 모두 비교한다", async () => {
    const { checkPortableSchemas, generatedDirectory } = await import("./generate-json-schema");
    const before = await Promise.all([
      readFile(join(generatedDirectory, "ingestion-v1.schema.json")),
      readFile(join(generatedDirectory, "ingestion-v2.schema.json")),
    ]);

    await checkPortableSchemas();

    const drifted = await mkdtemp(join(tmpdir(), "eatbid-contracts-multi-drift-"));
    temporaryDirectories.push(drifted);
    await writeFile(join(drifted, "ingestion-v1.schema.json"), before[0]!);
    await writeFile(join(drifted, "ingestion-v2.schema.json"), Buffer.from("{\"drifted\":true}\n", "utf8"));

    await expect(checkPortableSchemas(drifted)).rejects.toThrow("ingestion-v2.schema.json");
    const after = await Promise.all([
      readFile(join(generatedDirectory, "ingestion-v1.schema.json")),
      readFile(join(generatedDirectory, "ingestion-v2.schema.json")),
    ]);
    expect(after[0]!.equals(before[0]!)).toBe(true);
    expect(after[1]!.equals(before[1]!)).toBe(true);
  });

  test("registry에 없는 잔존 artifact가 남아 있으면 check mode가 실패한다", async () => {
    const { checkPortableSchemas, emitPortableSchemas } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-stale-"));
    temporaryDirectories.push(directory);

    await emitPortableSchemas(directory);
    await checkPortableSchemas(directory);

    const stalePath = join(directory, "ingestion-v0.schema.json");
    await writeFile(stalePath, "{}\n", "utf8");
    await expect(checkPortableSchemas(directory)).rejects.toThrow("ingestion-v0.schema.json");
  });

  test("InstantText는 Python generator가 소비할 단일 scalar pattern으로 생성된다", async () => {
    const { emitPortableSchema } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-instant-"));
    temporaryDirectories.push(directory);
    const schemaPath = await emitPortableSchema("EatbidIngestionAuctionV1", directory);
    const document = JSON.parse(await readFile(schemaPath, "utf8"));
    const instantText = document.$defs.InstantText;

    expect(instantText.type).toBe("string");
    expect(typeof instantText.pattern).toBe("string");
    expect(instantText).not.toHaveProperty("allOf");
  });

  test("check mode는 임시 생성물과 비교하고 추적 artifact를 다시 쓰지 않는다", async () => {
    const { checkPortableSchema, portableSchemaPath } = await import("./generate-json-schema");
    const committedPath = portableSchemaPath("EatbidIngestionAuctionV1");
    const beforeBytes = await readFile(committedPath);
    const beforeStat = await stat(committedPath);

    await checkPortableSchema("EatbidIngestionAuctionV1");

    const afterBytes = await readFile(committedPath);
    const afterStat = await stat(committedPath);
    expect(afterBytes.equals(beforeBytes)).toBe(true);
    expect(afterStat.mtimeMs).toBe(beforeStat.mtimeMs);
  });

  test("생성 artifact가 drift하면 check mode가 실패하고 기존 bytes를 보존한다", async () => {
    const { checkPortableSchema } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-drift-"));
    temporaryDirectories.push(directory);
    const driftedPath = join(directory, "ingestion-v1.schema.json");
    const drifted = Buffer.from("{\"drifted\":true}\n", "utf8");
    await writeFile(driftedPath, drifted);

    await expect(checkPortableSchema("EatbidIngestionAuctionV1", driftedPath)).rejects.toThrow(
      "Generated JSON Schema differs",
    );
    expect((await readFile(driftedPath)).equals(drifted)).toBe(true);
  });

  test("Windows CRLF checkout도 logical JSON Schema drift로 오인하지 않는다", async () => {
    const { checkPortableSchema, renderPortableSchema } = await import("./generate-json-schema");
    const directory = await mkdtemp(join(tmpdir(), "eatbid-contracts-crlf-"));
    temporaryDirectories.push(directory);
    const crlfPath = join(directory, "ingestion-v1.schema.json");
    const crlfBytes = Buffer.from(
      renderPortableSchema("EatbidIngestionAuctionV1").replaceAll("\n", "\r\n"),
      "utf8",
    );
    await writeFile(crlfPath, crlfBytes);

    await checkPortableSchema("EatbidIngestionAuctionV1", crlfPath);

    expect((await readFile(crlfPath)).equals(crlfBytes)).toBe(true);
  });
});
