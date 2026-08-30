import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";

import { portableContracts } from "./portable-registry";

const artifactFileName = "ingestion-v1.schema.json";

export const ingestionV1SchemaPath = join(__dirname, "..", "generated", artifactFileName);

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

function ingestionV1Contract() {
  const sorted = [...portableContracts].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  const ids = sorted.map((entry) => entry.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Portable contract IDs must be unique");
  }

  const contract = sorted.find((entry) => entry.id === "EatbidIngestionAuctionV1");
  if (contract === undefined) throw new Error("EatbidIngestionAuctionV1 is not registered");
  return contract;
}

export function renderIngestionV1Schema(): string {
  const contract = ingestionV1Contract();
  const schema = z.toJSONSchema(contract.schema, {
    target: "draft-2020-12",
    unrepresentable: "throw",
    cycles: "throw",
  }) as JsonValue;
  const rootSchema = { ...(schema as { [key: string]: JsonValue }), $id: contract.id };
  return `${JSON.stringify(sortJsonKeys(rootSchema), null, 2)}\n`;
}

export async function emitIngestionV1Schema(outputDirectory: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, artifactFileName);
  await writeFile(outputPath, renderIngestionV1Schema(), "utf8");
  return outputPath;
}

export async function writeIngestionV1Schema(): Promise<void> {
  await emitIngestionV1Schema(dirname(ingestionV1SchemaPath));
}

export async function checkIngestionV1Schema(committedPath = ingestionV1SchemaPath): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-check-"));
  try {
    const temporaryPath = await emitIngestionV1Schema(temporaryDirectory);
    const [generated, committed] = await Promise.all([
      readFile(temporaryPath),
      readFile(committedPath),
    ]);
    const normalizeLineEndings = (bytes: Buffer) => Buffer.from(
      bytes.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
      "utf8",
    );
    if (!normalizeLineEndings(generated).equals(normalizeLineEndings(committed))) {
      throw new Error(`Generated JSON Schema differs from ${artifactFileName}; run pnpm contracts:generate`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [mode, ...rest] = process.argv.slice(2);
  if (rest.length > 0 || mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: bun src/generate-json-schema.ts --write|--check");
  }
  if (mode === "--write") await writeIngestionV1Schema();
  else await checkIngestionV1Schema();
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
