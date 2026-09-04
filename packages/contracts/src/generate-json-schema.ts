/** @module 책임: 등록된 계약마다 결정적 JSON Schema artifact를 내고 추적 생성물의 drift를 검사한다. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { portableContracts, type PortableContractId } from "./portable-registry";

export const generatedDirectory = join(__dirname, "..", "generated");
export const ingestionV1SchemaPath = join(generatedDirectory, "ingestion-v1.schema.json");

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function sortJsonKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, sortJsonKeys(child)]),
  );
}

function contractById(id: PortableContractId) {
  const ids = portableContracts.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Portable contract IDs must be unique");
  }
  const artifacts = portableContracts.map((entry) => entry.artifact);
  if (new Set(artifacts).size !== artifacts.length) {
    throw new Error("Portable contract artifacts must be unique");
  }

  const contract = portableContracts.find((entry) => entry.id === id);
  if (contract === undefined) throw new Error(`${id} is not registered`);
  return contract;
}

export function renderPortableSchema(id: PortableContractId): string {
  const contract = contractById(id);
  const schema = z.toJSONSchema(contract.schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    cycles: "throw",
  }) as JsonValue;
  const rootSchema = { ...(schema as { [key: string]: JsonValue }), $id: contract.id };
  return `${JSON.stringify(sortJsonKeys(rootSchema), null, 2)}\n`;
}

export function renderIngestionV1Schema(): string {
  return renderPortableSchema("EatbidIngestionAuctionV1");
}

export async function emitPortableSchemas(outputDirectory: string): Promise<readonly string[]> {
  await mkdir(outputDirectory, { recursive: true });
  const written: string[] = [];
  for (const entry of portableContracts) {
    const outputPath = join(outputDirectory, entry.artifact);
    await writeFile(outputPath, renderPortableSchema(entry.id), "utf8");
    written.push(outputPath);
  }
  return written;
}

export async function emitIngestionV1Schema(outputDirectory: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "ingestion-v1.schema.json");
  await writeFile(outputPath, renderIngestionV1Schema(), "utf8");
  return outputPath;
}

// check mode는 임시 디렉터리에만 쓴다. 추적 생성물을 다시 써서 mtime을 바꾸면 CI가 검사하려던 drift를
// 검사 자체가 지워버린다.
async function compareAgainstFreshEmission(
  expected: (temporaryDirectory: string) => Promise<readonly { artifact: string; path: string }[]>,
  committed: (artifact: string) => string,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-check-"));
  try {
    const normalizeLineEndings = (bytes: Buffer) => Buffer.from(
      bytes.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      "utf8",
    );
    for (const entry of await expected(temporaryDirectory)) {
      const [generated, tracked] = await Promise.all([
        readFile(entry.path),
        readFile(committed(entry.artifact)),
      ]);
      if (!normalizeLineEndings(generated).equals(normalizeLineEndings(tracked))) {
        throw new Error(`Generated JSON Schema differs from ${entry.artifact}; run pnpm contracts:generate`);
      }
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function checkPortableSchemas(directory = generatedDirectory): Promise<void> {
  await compareAgainstFreshEmission(
    async (temporaryDirectory) => {
      const paths = await emitPortableSchemas(temporaryDirectory);
      return portableContracts.map((entry, index) => ({ artifact: entry.artifact, path: paths[index]! }));
    },
    (artifact) => join(directory, artifact),
  );
}

export async function checkIngestionV1Schema(committedPath = ingestionV1SchemaPath): Promise<void> {
  await compareAgainstFreshEmission(
    async (temporaryDirectory) => [{
      artifact: "ingestion-v1.schema.json",
      path: await emitIngestionV1Schema(temporaryDirectory),
    }],
    () => committedPath,
  );
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: bun src/generate-json-schema.ts --write|--check");
  }
  if (mode === "--write") await emitPortableSchemas(generatedDirectory);
  else await checkPortableSchemas();
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
