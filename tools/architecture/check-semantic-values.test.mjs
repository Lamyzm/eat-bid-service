import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(repositoryRoot, "tools", "architecture", "check-semantic-values.mjs");
const temporaryDirectories = [];

function fixture(files, baseline = { version: 1, entries: [] }, { includeRegistry = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-semantic-values-"));
  temporaryDirectories.push(root);
  const fixtureFiles = { ...files };
  if (includeRegistry && !("packages/contracts/src/portable-registry.ts" in fixtureFiles)) {
    fixtureFiles["packages/contracts/src/portable-registry.ts"] = [
      "import { z } from 'zod';",
      "const schema = z.string();",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema }]);",
    ].join("\n");
  }
  for (const [relativePath, contents] of Object.entries(fixtureFiles)) {
    const file = path.join(root, relativePath);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  const baselinePath = path.join(root, "semantic-value-legacy-baseline.json");
  writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  return { root, baselinePath };
}

function run(target, ...args) {
  const result = spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      SEMANTIC_VALUES_ROOT: target.root,
      SEMANTIC_VALUES_BASELINE: target.baselinePath,
    },
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function expectViolation(source, rule, relativePath = "apps/server/src/example.ts") {
  const target = fixture({ [relativePath]: source });
  const result = run(target);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, new RegExp(`\\[${rule}\\]`));
}

test.after(() => {
  for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true });
});

test("전역 Date와 Temporal.Now의 직접·별칭·구조분해·조건부 우회를 거부한다", () => {
  const mutations = [
    ["new Date();", "ambient-date"],
    ["Date.now();", "ambient-date"],
    ["const SystemDate = Date; SystemDate.parse('2026-08-30');", "ambient-date"],
    ["const { now: currentTime } = Date; currentTime();", "ambient-date"],
    ["const Clock = condition ? Date : class Safe {}; new Clock();", "ambient-date"],
    ["globalThis.Date.now();", "ambient-date"],
    ["let Clock = SafeDate; Clock = globalThis.Date; new Clock();", "ambient-date"],
    ["let currentTime; ({ now: currentTime } = Date); currentTime();", "ambient-date"],
    ["import { Temporal } from '@eatbid/domain'; Temporal.Now.instant();", "ambient-temporal-now"],
    ["import { Temporal as T } from '@eatbid/domain'; const { Now } = T; Now.instant();", "ambient-temporal-now"],
    ["import { Temporal } from '@eatbid/domain'; const T = condition ? Temporal : safe; T.Now.instant();", "ambient-temporal-now"],
    ["import * as Domain from '@eatbid/domain'; Domain.Temporal.Now.instant();", "ambient-temporal-now"],
  ];
  for (const [source, rule] of mutations) expectViolation(source, rule);

  expectViolation(
    "import { Temporal } from './temporal'; export const backupClock = { now: () => Temporal.Now.instant() };",
    "ambient-temporal-now",
    "packages/domain/src/time/clock.ts",
  );
  expectViolation(
    "function otherRowBridge(value: Date | string) { return value instanceof Date ? value.getTime() : value; }",
    "ambient-date",
    "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts",
  );
  expectViolation(
    "import { Temporal } from './temporal'; function trap() { const systemClock = { now: () => Temporal.Now.instant() }; return systemClock; }",
    "ambient-temporal-now",
    "packages/domain/src/time/clock.ts",
  );
  expectViolation(
    "function outer() { type AuctionRow = { announced_at: Date | string }; return null as AuctionRow | null; }",
    "ambient-date",
    "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts",
  );
  expectViolation(
    "function outer() { function postgresInstant(value: Date | string) { return value instanceof Date ? value.getTime() : value; } return postgresInstant; }",
    "ambient-date",
    "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts",
  );
});

test("금지 날짜 라이브러리의 정적·require·dynamic import 별칭을 거부한다", () => {
  const mutations = [
    "import dayjs from 'dayjs'; dayjs();",
    "const packageName = 'date-fns'; require(packageName);",
    "const packageName = condition ? 'moment' : 'luxon'; import(packageName);",
  ];
  for (const source of mutations) expectViolation(source, "forbidden-date-library");
});

test("원시 timer 값과 단위 없는 timeout·interval·TTL 선언의 우회를 거부한다", () => {
  const mutations = [
    "setTimeout(callback, 5_000);",
    "const later = setTimeout; later(callback, 2 * 1_000);",
    "const { setInterval: repeat } = globalThis; repeat(callback, 500);",
    "const schedule = condition ? setTimeout : customTimer; schedule(callback, 25);",
    "window.setTimeout(callback, 250);",
    "interface Config { requestTimeout: number }",
    "type CacheOptions = { ttlMs: number };",
    "const retryInterval = 30 * 1_000;",
  ];
  for (const source of mutations) {
    const rule = /setTimeout|setInterval|later|repeat|schedule/.test(source)
      ? "raw-timer-value"
      : "untyped-duration";
    expectViolation(source, rule);
  }
});

test("canonical 부동 DDL과 Drizzle bigint number mode의 별칭·구조분해·조건부 우회를 거부한다", () => {
  const mutations = [
    ["import { doublePrecision } from 'drizzle-orm/pg-core'; doublePrecision('bid_rate');", "floating-canonical-ddl"],
    ["import * as pg from 'drizzle-orm/pg-core'; const floating = pg.real; floating('base_amount');", "floating-canonical-ddl"],
    ["import * as pg from 'drizzle-orm/pg-core'; const floating = condition ? pg.real : pg.doublePrecision; floating(columnName);", "floating-canonical-ddl"],
    ["import { doublePrecision } from 'drizzle-orm/pg-core'; doublePrecision('basePrice');", "floating-canonical-ddl"],
    ["import { bigint } from 'drizzle-orm/pg-core'; bigint('count', { mode: 'number' });", "bigint-number-mode"],
    ["import { bigint } from 'drizzle-orm/pg-core'; bigint({ mode: 'number' });", "bigint-number-mode"],
    ["import * as pg from 'drizzle-orm/pg-core'; const { bigint: exactId } = pg; const options = { mode: 'number' } as const; exactId('id', options);", "bigint-number-mode"],
    ["import { bigint } from 'drizzle-orm/pg-core'; const options = condition ? { mode: 'number' } : safe; bigint('id', options);", "bigint-number-mode"],
  ];
  for (const [source, rule] of mutations) expectViolation(source, rule, "packages/db/src/schema/example.ts");
});

test("손으로 작성한 공개 Response shape를 거부하고 application AuctionRecord와 Zod inferred type을 허용한다", () => {
  expectViolation(
    "export interface AuctionResponse { auctionId: string; amount: string }",
    "manual-public-response",
    "packages/contracts/src/api/v1/auction.ts",
  );
  expectViolation(
    "export type AuctionHttpResponse = { auctionId: string; amount: string };",
    "manual-public-response",
    "apps/server/src/modules/procurement/presentation/http/types.ts",
  );
  expectViolation(
    "export interface AuctionPayload { auctionId: string; amount: string }",
    "manual-public-response",
    "packages/contracts/src/api/v1/auction.ts",
  );
  expectViolation(
    "export type AuctionEnvelope = Readonly<{ auctionId: string; amount: string }>;",
    "manual-public-response",
    "apps/server/src/modules/procurement/presentation/http/types.ts",
  );
  expectViolation(
    "type AuctionEnvelope = { auctionId: string; amount: string }; export { AuctionEnvelope };",
    "manual-public-response",
    "packages/contracts/src/api/v1/auction.ts",
  );

  const target = fixture({
    "apps/server/src/modules/procurement/application/auction-reader.ts":
      "export interface AuctionRecord { readonly auctionId: bigint }",
    "packages/contracts/src/api/v1/auction.ts": [
      "import { z } from 'zod';",
      "const auctionSchema = z.strictObject({ auctionId: z.string() });",
      "export type AuctionResponse = z.infer<typeof auctionSchema>;",
      "type AuctionEnvelope = z.infer<typeof auctionSchema>;",
      "export { AuctionEnvelope };",
    ].join("\n"),
  });
  const result = run(target);
  assert.equal(result.status, 0, result.output);
});

test("portable schema graph의 codec·transform·runtime custom predicate를 별칭과 조건부 경로까지 거부한다", () => {
  const mutations = [
    "export const schema = z.string().transform((value) => value.trim());",
    "const makeCodec = z.codec; export const schema = makeCodec(z.string(), z.string(), { decode: String, encode: String });",
    "const { custom: runtimeCustom } = z; export const schema = runtimeCustom<string>();",
    "const clean = z.string(); const unsafe = z.string().refine(Boolean); export const schema = condition ? clean : unsafe;",
  ];
  for (const source of mutations) {
    const target = fixture({
      "packages/contracts/src/portable-schema.ts": `import { z } from 'zod';\n${source}\n`,
      "packages/contracts/src/portable-registry.ts": [
        "import { schema as portableSchema } from './portable-schema';",
        "export const portableContracts = Object.freeze([{ id: 'Fixture', schema: portableSchema }]);",
      ].join("\n"),
    });
    const result = run(target);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output, /\[nonportable-schema\]/);
  }
});

test("portable registry와 top-level root가 없으면 실패하고 도달 가능한 factory body를 검사한다", () => {
  const missingRegistry = fixture({
    "packages/contracts/src/portable-schema.ts": "import { z } from 'zod'; export const schema = z.string();",
  }, { version: 1, entries: [] }, { includeRegistry: false });
  const missingRegistryResult = run(missingRegistry);
  assert.notEqual(missingRegistryResult.status, 0, missingRegistryResult.output);
  assert.match(missingRegistryResult.output, /portable registry.*required/i);

  const missingRoot = fixture({
    "packages/contracts/src/portable-registry.ts": "import { z } from 'zod'; export const other = z.string();",
  });
  const missingRootResult = run(missingRoot);
  assert.notEqual(missingRootResult.status, 0, missingRootResult.output);
  assert.match(missingRootResult.output, /top-level portableContracts.*required/i);

  const factory = fixture({
    "packages/contracts/src/portable-factory.ts": [
      "import { z } from 'zod';",
      "export function buildSchema() {",
      "  return z.string().transform((value) => value.trim());",
      "}",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { buildSchema } from './portable-factory';",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema: buildSchema() }]);",
    ].join("\n"),
  });
  const factoryResult = run(factory);
  assert.notEqual(factoryResult.status, 0, factoryResult.output);
  assert.match(factoryResult.output, /\[nonportable-schema\]/);
});

test("portable shorthand registry의 schema symbol과 factory를 따라 overwrite를 거부한다", () => {
  const shorthand = fixture({
    "packages/contracts/src/portable-schema.ts": [
      "import { z } from 'zod';",
      "export const schema = z.string().transform((value) => value.trim());",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { schema } from './portable-schema';",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema }]);",
    ].join("\n"),
  });
  const shorthandResult = run(shorthand);
  assert.notEqual(shorthandResult.status, 0, shorthandResult.output);
  assert.match(shorthandResult.output, /\[nonportable-schema\]/);

  const overwriteFactory = fixture({
    "packages/contracts/src/portable-factory.ts": [
      "import { z } from 'zod';",
      "export function buildSchema() {",
      "  return z.string().overwrite((value) => value.trim());",
      "}",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { buildSchema } from './portable-factory';",
      "const id = 'Fixture';",
      "const schema = buildSchema();",
      "export const portableContracts = Object.freeze([{ id, schema }]);",
    ].join("\n"),
  });
  const overwriteResult = run(overwriteFactory);
  assert.notEqual(overwriteResult.status, 0, overwriteResult.output);
  assert.match(overwriteResult.output, /\[nonportable-schema\]/);
});

test("portable factory 안의 non-Zod transform helper는 schema transform으로 오인하지 않는다", () => {
  const target = fixture({
    "packages/contracts/src/text-helper.ts": "export function transform(value) { return value.trim(); }",
    "packages/contracts/src/portable-factory.ts": [
      "import { z } from 'zod';",
      "import { transform } from './text-helper';",
      "class ZodString { transform(value) { return value.trim(); } }",
      "export function buildSchema() {",
      "  transform(' label ');",
      "  new ZodString().transform(' label ');",
      "  return z.string();",
      "}",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { buildSchema } from './portable-factory';",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema: buildSchema() }]);",
    ].join("\n"),
  });
  const result = run(target);
  assert.equal(result.status, 0, result.output);
});

test("portable registry 밖의 guarded z.custom과 정확히 이름 붙은 adapter·semantic duration은 허용한다", () => {
  const target = fixture({
    "packages/contracts/src/codecs/guarded.ts": [
      "import { z } from 'zod';",
      "export const guardedOutput = z.custom<{ ok: true }>((value) => Boolean(value));",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { z } from 'zod';",
      "const schema = z.strictObject({ value: z.string() });",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema }]);",
    ].join("\n"),
    "packages/domain/src/time/clock.ts": [
      "import { Temporal } from './temporal';",
      "export const systemClock = { now: () => Temporal.Now.instant() };",
    ].join("\n"),
    "apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts": [
      "type AuctionRow = { announced_at: Date | string | null };",
      "function postgresInstant(value: Date | string | null) {",
      "  return value instanceof Date ? value.getTime() : value;",
      "}",
    ].join("\n"),
    "apps/server/src/timers.ts": [
      "import { seconds, toMilliseconds, type ElapsedMilliseconds } from '@eatbid/domain';",
      "const retryTimeout = seconds(5);",
      "function wait(grace: ElapsedMilliseconds) {",
      "  const delay = toMilliseconds(grace);",
      "  return setTimeout(callback, delay);",
      "}",
      "const Date = class LocalDate { static now() { return 0; } };",
      "Date.now();",
    ].join("\n"),
  });
  const result = run(target);
  assert.equal(result.status, 0, result.output);
});

test("counterfeit duration helper는 raw timer 값을 semantic duration으로 세탁하지 못한다", () => {
  const target = fixture({
    "apps/server/src/fake-duration.ts": "export const seconds = (value) => value * 1000;",
    "apps/server/src/timers.ts": [
      "import { seconds } from './fake-duration';",
      "const delay = seconds(5);",
      "setTimeout(callback, delay);",
    ].join("\n"),
    "packages/contracts/src/portable-registry.ts": [
      "import { z } from 'zod';",
      "const schema = z.string();",
      "export const portableContracts = Object.freeze([{ id: 'Fixture', schema }]);",
    ].join("\n"),
  });
  const result = run(target);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /\[raw-timer-value\]/);
});

test("legacy ledger는 정확한 path·node kind·normalized text hash만 허용하고 삭제만 허용한다", () => {
  const target = fixture({ "apps/web/src/legacy.ts": "export const now = Date.now();\n" });
  const writeResult = run(target, "--write-baseline");
  assert.equal(writeResult.status, 0, writeResult.output);
  const written = JSON.parse(readFileSync(target.baselinePath, "utf8"));
  assert.equal(written.entries.length, 1);
  assert.deepEqual(
    Object.keys(written.entries[0]),
    ["path", "rule", "nodeKind", "fingerprint", "reason", "removalGate"],
  );
  assert.equal(run(target).status, 0);

  writeFileSync(path.join(target.root, "apps/web/src/legacy.ts"), "export const now = Date.parse('2026-08-30');\n");
  const drift = run(target);
  assert.notEqual(drift.status, 0, drift.output);
  assert.match(drift.output, /legacy fingerprint drift/);

  writeFileSync(path.join(target.root, "apps/web/src/legacy.ts"), "export const now = 0;\n");
  assert.equal(run(target).status, 0, "baseline deletion must be allowed");

  writeFileSync(
    path.join(target.root, "apps/web/src/legacy.ts"),
    "export const first = Date.now();\nexport const second = Date.now();\n",
  );
  const duplicateAddition = run(target);
  assert.notEqual(duplicateAddition.status, 0, duplicateAddition.output);
  assert.match(duplicateAddition.output, /new legacy violation/);
});

test("baseline write mode도 backend 위반을 예외로 만들지 않는다", () => {
  const target = fixture({ "apps/server/src/bad.ts": "Date.now();\n" });
  const result = run(target, "--write-baseline");
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /\[ambient-date\]/);
  assert.equal(JSON.parse(readFileSync(target.baselinePath, "utf8")).entries.length, 0);
});
