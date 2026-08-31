import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReuseCatalog } from "./reuse-catalog.mjs";

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-reuse-catalog-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return root;
}

async function catalog(files, options = {}) {
  const root = fixture({
    "package.json": "{\"private\":true}\n",
    "apps/web/package.json": "{\"name\":\"@eatbid/web\",\"private\":true}\n",
    ...files,
  });
  try {
    return await buildReuseCatalog({ repoRoot: root, changedPaths: [], ...options });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("extensionless import는 ts와 tsx를 구분하고 consumer를 한 번만 기록한다", async () => {
  const result = await catalog({
    "apps/web/src/hooks/use-choice.ts": "export type Choice = 'one' | 'two'; export const useChoice = (): Choice => 'one';\n",
    "apps/web/src/hooks/use-choice.tsx": "export const useChoiceView = () => null;\n",
    "apps/web/src/components/consumer.tsx": "import { useChoice } from '@/hooks/use-choice'; export { useChoice as choice } from '@/hooks/use-choice'; void useChoice;\n",
  });
  const implementation = result.modules.find((module) => module.path === "apps/web/src/hooks/use-choice.ts");
  const view = result.modules.find((module) => module.path === "apps/web/src/hooks/use-choice.tsx");

  assert.deepEqual(implementation.exports, ["Choice", "useChoice"]);
  assert.deepEqual(implementation.directConsumers, ["apps/web/src/components/consumer.tsx"]);
  assert.deepEqual(view.directConsumers, []);
});

test("named default와 local star re-export의 실제 symbol 이름을 기록한다", async () => {
  const result = await catalog({
    "apps/web/src/hooks/use-entry.ts": "export { useCore as useAlias, type Core } from './use-core'; export * from './use-extra'; export default function useDefault() { return true; }\n",
    "apps/web/src/hooks/use-core.ts": "export type Core = { ready: boolean }; export const useCore = () => true;\n",
    "apps/web/src/hooks/use-extra.ts": "export const useExtra = () => true; export default function hiddenDefault() { return false; }\n",
  });

  assert.deepEqual(result.modules.find((module) => module.path.endsWith("use-entry.ts")).exports, ["Core", "default", "useAlias", "useExtra"]);
});

test("consumer가 없는 module은 candidate이며 unused나 blocking finding이 아니다", async () => {
  const result = await catalog({
    "apps/web/src/hooks/use-orphan.ts": "export const useOrphan = () => 'candidate';\n",
  });
  const candidate = result.modules.find((module) => module.path === "apps/web/src/hooks/use-orphan.ts");

  assert.equal(candidate.reviewStatus, "candidate");
  assert.equal(candidate.consumerCount, 0);
  assert.deepEqual(result.blockingFindings, []);
  assert.doesNotMatch(JSON.stringify(result), /unused/i);
});

test("동일한 hook source는 duplicate group 하나로 묶고 전체 source를 보존한다", async () => {
  const source = "export function useViewport() {\n  return { mobile: false };\n}\n";
  const result = await catalog({
    "apps/web/src/hooks/use-viewport.ts": source,
    "apps/web/src/hooks/use-viewport.tsx": source,
  });

  assert.equal(result.duplicateGroups.length, 1);
  assert.deepEqual(result.duplicateGroups[0].members, [
    "apps/web/src/hooks/use-viewport.ts",
    "apps/web/src/hooks/use-viewport.tsx",
  ]);
  assert.equal(result.modules.find((module) => module.path.endsWith("use-viewport.ts")).source, source);
});

test("es-toolkit declaration과 version을 실제 설치 경로에서 읽고 transitive 정책을 명시한다", async () => {
  const declaration = "export declare function groupBy<T>(items: T[]): Record<string, T[]>;\n";
  const result = await catalog({
    "apps/web/src/hooks/use-choice.ts": "export const useChoice = () => 1;\n",
    "node_modules/.pnpm/node_modules/es-toolkit/package.json": "{\"name\":\"es-toolkit\",\"version\":\"9.8.7\"}\n",
    "node_modules/.pnpm/node_modules/es-toolkit/dist/index.d.ts": declaration,
  });

  assert.equal(result.esToolkit.installed, true);
  assert.equal(result.esToolkit.version, "9.8.7");
  assert.equal(result.esToolkit.declaration, declaration);
  assert.equal(result.esToolkit.directDeclared, false);
  assert.equal(result.esToolkit.productionImportPolicy, "transitive-only");
  assert.match(result.esToolkit.warning, /direct.*forbidden|직접.*금지/i);
});

test("root나 Web manifest의 exact declaration만 es-toolkit direct dependency로 인정한다", async () => {
  const result = await catalog({
    "apps/web/package.json": "{\"name\":\"@eatbid/web\",\"dependencies\":{\"es-toolkit\":\"1.2.3\"}}\n",
    "apps/web/src/hooks/use-choice.ts": "export const useChoice = () => 1;\n",
    "node_modules/.pnpm/node_modules/es-toolkit/package.json": "{\"name\":\"es-toolkit\",\"version\":\"1.2.3\"}\n",
    "node_modules/.pnpm/node_modules/es-toolkit/dist/index.d.ts": "export declare const noop: () => void;\n",
  });

  assert.equal(result.esToolkit.directDeclared, true);
  assert.equal(result.esToolkit.declaredVersion, "1.2.3");
  assert.equal(result.esToolkit.productionImportPolicy, "direct-dependency-reviewed");
});

test("secret generated lockfile과 byte cap 초과 source는 context evidence에서 제외한다", async () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  const result = await catalog({
    "apps/web/src/components/changed.ts": "export const changed = 'safe';\n",
    "apps/web/src/components/changed-sensitive.ts": `export const apiToken = '${secret}';\n`,
    "apps/web/src/components/large.ts": `export const large = '${"x".repeat(200)}';\n`,
    "apps/web/src/components/total-a.ts": `export const totalA = '${"a".repeat(48)}';\n`,
    "apps/web/src/components/total-b.ts": `export const totalB = '${"b".repeat(48)}';\n`,
    "apps/web/.next/generated.ts": "export const generated = 'skip';\n",
    "apps/web/.env.local": "TOKEN=private\n",
    "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
  }, {
    changedPaths: [
      "apps/web/src/components/changed.ts",
      "apps/web/src/components/changed-sensitive.ts",
      "apps/web/src/components/large.ts",
      "apps/web/src/components/total-a.ts",
      "apps/web/src/components/total-b.ts",
      "apps/web/.next/generated.ts",
      "apps/web/.env.local",
      "pnpm-lock.yaml",
    ],
    perFileByteCap: 96,
    totalSourceByteCap: 128,
  });

  assert.equal(result.modules.find((module) => module.path.endsWith("changed.ts")).source, "export const changed = 'safe';\n");
  assert.equal(result.modules.find((module) => module.path.endsWith("changed-sensitive.ts")).source, undefined);
  assert.equal(result.modules.find((module) => module.path.endsWith("large.ts")).source, undefined);
  assert.ok(result.exclusions.some((item) => item.path.endsWith("changed-sensitive.ts") && item.reason === "sensitive-content"));
  assert.ok(result.exclusions.some((item) => item.path.endsWith("large.ts") && item.reason === "per-file-byte-cap"));
  assert.ok(result.exclusions.some((item) => item.path.endsWith("total-b.ts") && item.reason === "total-source-byte-cap"));
  assert.ok(result.exclusions.some((item) => item.path === "apps/web/.next/generated.ts" && item.reason === "generated-output"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
  assert.doesNotMatch(JSON.stringify(result.modules), /pnpm-lock|\.env\.local|generated\.ts/);
});

test("인증 credential은 근거 본문을 남기지 않고 일반 authorization 문장은 보존한다", async () => {
  const credentials = {
    "apps/web/src/components/bearer.ts": "export const headers = { Authorization: 'Bearer opaque-access-credential-123456' };\n",
    "apps/web/src/components/basic.ts": "export const headers = { authorization: 'Basic dXNlcjpwYXNzd29yZA==' };\n",
    "apps/web/src/components/jwt.ts": "export const session = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature-value';\n",
    "apps/web/src/components/userinfo.ts": "export const endpoint = 'https://reviewer:super-secret@example.com/private';\n",
    "apps/web/src/components/assignment.ts": "export const ClientSecret = 'obvious-credential-value-12345';\n",
  };
  const result = await catalog({
    ...credentials,
    "apps/web/src/components/vocabulary.ts": "export const note = 'Authorization vocabulary describes access policy';\nexport const tokenCount = 3;\n",
  }, { changedPaths: [...Object.keys(credentials), "apps/web/src/components/vocabulary.ts"] });

  for (const credentialPath of Object.keys(credentials)) {
    assert.equal(result.modules.find((module) => module.path === credentialPath)?.source, undefined);
    assert.ok(result.exclusions.some((item) => item.path === credentialPath && item.reason === "sensitive-content"));
  }
  assert.match(result.modules.find((module) => module.path.endsWith("vocabulary.ts")).source, /Authorization vocabulary/);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /opaque-access-credential|dXNlcjpwYXNzd29yZA|eyJhbGci|reviewer:super-secret|obvious-credential-value/);
});

test("generated 경로와 파일명은 대소문자와 Windows 구분자를 정규화하고 generator는 허용한다", async () => {
  const result = await catalog({
    "apps/web/src/Generated/one.ts": "export const one = 'hidden-one';\n",
    "apps/web/src/__GENERATED__/two.ts": "export const two = 'hidden-two';\n",
    "apps/web/src/GEN/three.ts": "export const three = 'hidden-three';\n",
    "apps/web/src/shared/schema.GENERATED.ts": "export const schema = 'hidden-schema';\n",
    "apps/web/src/shared/client.gen.ts": "export const client = 'hidden-client';\n",
    "apps/web/src/shared/generator.ts": "export const generator = 'visible-generator';\n",
  }, { changedPaths: [
    "apps\\web\\src\\Generated\\one.ts",
    "apps/web/src/__GENERATED__/two.ts",
    "apps\\web\\src\\GEN\\three.ts",
    "apps/web/src/shared/schema.GENERATED.ts",
    "apps/web/src/shared/client.gen.ts",
    "apps/web/src/shared/generator.ts",
  ] });

  assert.deepEqual(result.modules.map((module) => module.path), ["apps/web/src/shared/generator.ts"]);
  assert.equal(result.modules[0].source, "export const generator = 'visible-generator';\n");
  for (const generatedPath of [
    "apps/web/src/Generated/one.ts",
    "apps/web/src/__GENERATED__/two.ts",
    "apps/web/src/GEN/three.ts",
    "apps/web/src/shared/schema.GENERATED.ts",
    "apps/web/src/shared/client.gen.ts",
  ]) assert.ok(result.exclusions.some((item) => item.path === generatedPath && item.reason === "generated-output"));
  assert.doesNotMatch(JSON.stringify(result), /hidden-one|hidden-two|hidden-three|hidden-schema|hidden-client/);
});
