/** @module 책임: 등록된 계약마다 결정적 JSON Schema artifact를 내고 추적 생성물의 drift를 검사한다. */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { z } from "zod";

import { portableContracts, type PortableContractId } from "./portable-registry";

export const generatedDirectory = join(__dirname, "..", "generated");
const artifactSuffix = ".schema.json";

// registry가 id와 artifact 이름 양쪽으로 주소 지정 가능해야 emitter가 무엇을 어디에 쓸지 결정된다.
// 중복은 프로그래밍 오류이므로 생성이나 검사를 시작하기 전에 모듈 적재 시점 한 번만 확인하고 멈춘다.
const registeredArtifacts: ReadonlyMap<string, PortableContractId> = new Map(
  portableContracts.map((entry) => [entry.artifact, entry.id] as const),
);
if (new Set(portableContracts.map((entry) => entry.id)).size !== portableContracts.length) {
  throw new Error("Portable contract IDs must be unique");
}
if (registeredArtifacts.size !== portableContracts.length) {
  throw new Error("Portable contract artifacts must be unique");
}

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

export function portableSchemaPath(id: PortableContractId): string {
  return join(generatedDirectory, contractById(id).artifact);
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

export async function emitPortableSchema(id: PortableContractId, outputDirectory: string): Promise<string> {
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, contractById(id).artifact);
  await writeFile(outputPath, renderPortableSchema(id), "utf8");
  return outputPath;
}

// Windows checkout이 CRLF로 받은 파일을 논리적 drift로 오인하지 않도록 줄끝만 정규화해 비교한다.
async function assertSameBytes(artifact: string, generatedPath: string, committedPath: string): Promise<void> {
  const normalizeLineEndings = (bytes: Buffer) => Buffer.from(
    bytes.toString("utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
    "utf8",
  );
  const [generated, tracked] = await Promise.all([readFile(generatedPath), readFile(committedPath)]);
  if (!normalizeLineEndings(generated).equals(normalizeLineEndings(tracked))) {
    throw new Error(`Generated JSON Schema differs from ${artifact}; run pnpm contracts:generate`);
  }
}

// check mode는 임시 디렉터리에만 쓴다. 추적 생성물을 다시 써서 mtime을 바꾸면 CI가 검사하려던 drift를
// 검사 자체가 지워버린다.
async function withFreshEmission(
  consume: (emitted: ReadonlyMap<string, string>) => Promise<void>,
): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-check-"));
  try {
    const paths = await emitPortableSchemas(temporaryDirectory);
    await consume(new Map(paths.map((path) => [basename(path), path] as const)));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export async function checkPortableSchemas(directory = generatedDirectory): Promise<void> {
  // 등록에서 빠진 계약의 생성물이 남아 있으면 소비자는 아무도 갱신하지 않는 죽은 artifact를 계속 읽는다.
  // 위치가 아니라 artifact 이름으로 짝지어야 registry 순서를 바꿔도 엉뚱한 파일과 비교하지 않는다.
  const present = (await readdir(directory)).filter((name) => name.endsWith(artifactSuffix)).sort();
  for (const name of present) {
    if (!registeredArtifacts.has(name)) {
      throw new Error(`${name} is not a registered portable contract artifact; delete the stale generated file`);
    }
  }

  await withFreshEmission(async (emitted) => {
    for (const artifact of registeredArtifacts.keys()) {
      const generatedPath = emitted.get(artifact);
      if (generatedPath === undefined) throw new Error(`${artifact} was not emitted by the portable registry`);
      await assertSameBytes(artifact, generatedPath, join(directory, artifact));
    }
  });
}

export async function checkPortableSchema(
  id: PortableContractId,
  committedPath = portableSchemaPath(id),
): Promise<void> {
  const artifact = contractById(id).artifact;
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "eatbid-contracts-check-"));
  try {
    await assertSameBytes(artifact, await emitPortableSchema(id, temporaryDirectory), committedPath);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
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
