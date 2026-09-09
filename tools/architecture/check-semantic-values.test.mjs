import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(repositoryRoot, "tools", "architecture", "check-semantic-values.mjs");
const temporaryDirectories = [];

function fixture(files, { includeRegistry = true } = {}) {
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
  return { root };
}

function run(target, { args = [], env: extraEnv = {} } = {}) {
  const env = { ...process.env, SEMANTIC_VALUES_ROOT: target.root };
  delete env.EATBID_CHANGED_PATHS;
  delete env.EATBID_CHANGED_BASE;
  Object.assign(env, extraEnv);
  const result = spawnSync(process.execPath, [checker, ...args], {
    cwd: repositoryRoot,
    env,
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
    ["const Clock = condition && Date; new Clock();", "ambient-date"],
    ["globalThis.Date.now();", "ambient-date"],
    ["let Clock = SafeDate; Clock = globalThis.Date; new Clock();", "ambient-date"],
    ["let currentTime; ({ now: currentTime } = Date); currentTime();", "ambient-date"],
    ["let currentTime; ({ now: currentTime = safeNow } = Date); currentTime();", "ambient-date"],
    ["import { Temporal } from '@eatbid/domain'; Temporal.Now.instant();", "ambient-temporal-now"],
    ["import { Temporal as T } from '@eatbid/domain'; const { Now } = T; Now.instant();", "ambient-temporal-now"],
    ["import { Temporal } from '@eatbid/domain'; const T = condition ? Temporal : safe; T.Now.instant();", "ambient-temporal-now"],
    ["import { Temporal } from '@eatbid/domain'; const now = condition && Temporal.Now; now.instant();", "ambient-temporal-now"],
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

test("구조분해 default의 source와 initializer origin을 모두 추적한다", () => {
  const forbiddenDefaults = [
    "let currentTime; ({ now: currentTime = Date.now } = {}); currentTime();",
    "let Clock; ({ Clock = Date } = {}); new Clock();",
    "const { value: currentTime = Date.now } = {}; currentTime();",
  ];
  const missed = [];
  for (const source of forbiddenDefaults) {
    const result = run(fixture({ "apps/server/src/defaults.ts": source }));
    if (result.status === 0) missed.push(source);
    else assert.match(result.output, /\[ambient-date\]/);
  }
  assert.deepEqual(missed, []);

  const safe = fixture({
    "apps/server/src/defaults.ts": [
      "let Clock;",
      "({ Clock = SafeClock } = {});",
      "new Clock();",
      "const { value: currentTime = safeNow } = {};",
      "currentTime();",
    ].join("\n"),
  });
  const safeResult = run(safe);
  assert.equal(safeResult.status, 0, safeResult.output);
});

test("금지 날짜 라이브러리의 정적·require·dynamic import 별칭을 거부한다", () => {
  const mutations = [
    "import dayjs from 'dayjs'; dayjs();",
    "const packageName = 'date-fns'; require(packageName);",
    "const packageName = condition ? 'moment' : 'luxon'; import(packageName);",
    "const packageName = condition && 'date-fns'; require(packageName);",
    "const packageName = condition && 'moment'; import(packageName);",
    "const packageName = condition || 'luxon'; import(packageName);",
    "const packageName = condition ?? 'dayjs'; import(packageName);",
  ];
  for (const source of mutations) expectViolation(source, "forbidden-date-library");
});

test("원시 timer 값과 단위 없는 timeout·interval·TTL 선언의 우회를 거부한다", () => {
  const mutations = [
    "setTimeout(callback, 5_000);",
    "const later = setTimeout; later(callback, 2 * 1_000);",
    "const { setInterval: repeat } = globalThis; repeat(callback, 500);",
    "const schedule = condition ? setTimeout : customTimer; schedule(callback, 25);",
    "const schedule = condition && setTimeout; schedule(callback, 25);",
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
    "packages/contracts/src/api/operation.ts": [
      "export type HttpMethod = 'get' | 'post';",
      "export interface OperationResponse<Schema> { readonly status: number; readonly schema: Schema }",
      "export interface PublicHttpOperation<PathSchema, ResponseSchema> {",
      "  readonly method: HttpMethod; readonly pathSchema: PathSchema; readonly responseSchema: ResponseSchema;",
      "}",
    ].join("\n"),
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
  }, { includeRegistry: false });
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

test("apps/web의 위반도 예외 ledger 없이 backend와 같은 판정으로 실패한다", () => {
  const target = fixture({
    "apps/web/src/screen.ts": "export const now = Date.now();\n",
    "apps/server/src/ok.ts": "export const value = 1;\n",
  });
  const result = run(target);
  assert.notEqual(result.status, 0, result.output);
  assert.match(result.output, /apps\/web\/src\/screen\.ts:1:\d+ \[ambient-date\]/);
  assert.doesNotMatch(result.output, /ledger|baseline|frozen/i);

  writeFileSync(path.join(target.root, "apps/web/src/screen.ts"), "export const now = 0;\n");
  const fixed = run(target);
  assert.equal(fixed.status, 0, fixed.output);
  assert.match(fixed.output, /통과했습니다\. 범위: 전체, governed source 3개/);
});

test("드라이버가 변경 경로를 넘기면 그 파일만 governed root로 삼되 portable registry는 항상 포함한다", () => {
  const target = fixture({
    "apps/web/src/screen.ts": "export const now = Date.now();\n",
    "apps/server/src/ok.ts": "export const value = 1;\n",
  });
  const scoped = run(target, { env: { EATBID_CHANGED_PATHS: "apps/server/src/ok.ts", EATBID_CHANGED_BASE: "main@abc1234" } });
  assert.equal(scoped.status, 0, scoped.output);
  assert.match(scoped.output, /드라이버 전달\(main@abc1234\) 1개 경로, governed source 2개/);

  const touched = run(target, { env: { EATBID_CHANGED_PATHS: "apps/web/src/screen.ts" } });
  assert.notEqual(touched.status, 0, touched.output);
  assert.match(touched.output, /screen\.ts:1:\d+ \[ambient-date\]/);

  // 드라이버가 전체 모드에서 base만 넘긴 경우(CI의 --base origin/main)에는 좁히지 않고 전체를 본다.
  const baseOnly = run(target, { env: { EATBID_CHANGED_BASE: "origin/main" } });
  assert.notEqual(baseOnly.status, 0, baseOnly.output);
  assert.match(baseOnly.output, /screen\.ts:1:\d+ \[ambient-date\]/);
});
