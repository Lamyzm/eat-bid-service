import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildReviewContext, MAX_REVIEW_CONTEXT_BYTES } from "./build-review-context.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-review-context-"));
  const defaults = {
    "package.json": "{\"private\":true}\n",
    "apps/web/package.json": "{\"name\":\"@eatbid/web\",\"dependencies\":{\"@tanstack/react-query\":\"5.0.0\"}}\n",
    "tools/architecture/web-boundary-legacy-baseline.json": "{\"version\":1,\"entries\":[]}\n",
  };
  for (const [relativePath, contents] of Object.entries({ ...defaults, ...files })) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return root;
}

function parseJsonSection(context, heading) {
  const sectionStart = context.indexOf(`## ${heading}\n\n`);
  assert.notEqual(sectionStart, -1, `${heading} section이 있어야 한다`);
  const fenceStart = context.indexOf("```json\n", sectionStart);
  assert.notEqual(fenceStart, -1, `${heading} JSON fence가 있어야 한다`);
  const jsonStart = fenceStart + "```json\n".length;
  const end = context.indexOf("\n```", jsonStart);
  assert.notEqual(end, -1, `${heading} section이 닫혀야 한다`);
  return JSON.parse(context.slice(jsonStart, end));
}

test("review context는 changed Web module과 reuse source를 결정적으로 포함하고 96 KiB를 넘지 않는다", async () => {
  const root = fixture({
    "apps/web/src/hooks/use-existing.ts": "export const useExisting = () => 'reuse-me';\n",
    "apps/web/src/components/changed.tsx": "import { useExisting } from '@/hooks/use-existing'; export const Changed = () => useExisting();\n",
    "node_modules/.pnpm/node_modules/es-toolkit/package.json": "{\"name\":\"es-toolkit\",\"version\":\"1.0.0\"}\n",
    "node_modules/.pnpm/node_modules/es-toolkit/dist/index.d.ts": "export declare const groupBy: Function;\n",
  });
  try {
    const scope = { baseRef: "base", changedPaths: ["apps/web/src/components/changed.tsx"] };
    const first = await buildReviewContext({ repoRoot: root, scope });
    const second = await buildReviewContext({ repoRoot: root, scope });

    assert.equal(first, second);
    assert.ok(Buffer.byteLength(first, "utf8") <= MAX_REVIEW_CONTEXT_BYTES);
    assert.match(first, /apps\/web\/src\/components\/changed\.tsx/);
    assert.match(first, /apps\/web\/src\/hooks\/use-existing\.ts/);
    assert.match(first, /reuse-me/);
    assert.match(first, /es-toolkit.*1\.0\.0/s);
    assert.match(first, /transitive-only/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review context는 350개 module에서도 필수 section과 완전한 JSON을 보존하며 결정적으로 예산화한다", async () => {
  const files = {};
  const changedPaths = [];
  for (let index = 0; index < 350; index += 1) {
    const relativePath = `apps/web/src/components/evidence-${String(index).padStart(3, "0")}.ts`;
    files[relativePath] = `export const evidence${index} = '${"x".repeat(80)}';\n`;
    changedPaths.push(relativePath);
  }
  const root = fixture(files);
  try {
    const first = await buildReviewContext({ repoRoot: root, scope: { changedPaths } });
    const second = await buildReviewContext({ repoRoot: root, scope: { changedPaths } });
    const catalog = parseJsonSection(first, "Repository reuse evidence");
    const boundaries = parseJsonSection(first, "Deterministic boundary evidence");
    const rules = parseJsonSection(first, "Curated advisory rules");
    const scope = parseJsonSection(first, "Scope");

    assert.equal(MAX_REVIEW_CONTEXT_BYTES, 98_304);
    assert.equal(first, second);
    assert.ok(Buffer.byteLength(first, "utf8") <= 98_304);
    assert.equal(Buffer.from(first, "utf8").toString("utf8"), first);
    assert.equal(scope.changedPaths.length, 350);
    assert.equal(boundaries.unmatchedFindingCount, 0);
    assert.ok(rules.suppressedAdvice.some((item) => item.id === "data.generic-swr"));
    assert.match(first, /## Reviewer contract\n\n/);
    assert.match(first, /These diagnostics remain authoritative/);
    assert.match(first, /## Curated advisory rules/);
    assert.match(first, /\n```\n?$/);
    assert.equal(catalog.contextBudget.reason, "context-byte-budget");
    assert.ok(catalog.contextBudget.omittedModuleCount > 0);
    assert.match(catalog.contextBudget.firstOmittedModulePath, /^apps\/web\/src\/components\/evidence-\d{3}\.ts$/);
    assert.match(catalog.contextBudget.lastOmittedModulePath, /evidence-349\.ts$/);
    assert.doesNotMatch(first, /review context truncated deterministically/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("review context는 secret과 generated evidence를 출력하지 않는다", async () => {
  const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz1234567890";
  const root = fixture({
    "apps/web/src/components/safe.ts": "export const safe = true;\n",
    "apps/web/src/components/secret.ts": `export const password = '${secret}';\n`,
    "apps/web/dist/generated.ts": "export const generated = 'hidden';\n",
    "pnpm-lock.yaml": "hidden-lock-content\n",
  });
  try {
    const context = await buildReviewContext({ repoRoot: root, scope: { changedPaths: [
      "apps/web/src/components/safe.ts",
      "apps/web/src/components/secret.ts",
      "apps/web/dist/generated.ts",
      "pnpm-lock.yaml",
    ] } });

    assert.match(context, /apps\/web\/src\/components\/safe\.ts/);
    assert.doesNotMatch(context, new RegExp(secret));
    assert.doesNotMatch(context, /hidden-lock-content|hidden';/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("curated rule은 stable metadata와 React useEffectEvent 최신 의미를 가진다", () => {
  const catalog = JSON.parse(readFileSync(path.join(toolRoot, "catalog", "frontend-advisory-rules.json"), "utf8"));
  const expectedIds = [
    "architecture.business-view-separation",
    "next.independent-async-waterfalls",
    "next.measured-dynamic-imports",
    "next.rsc-serialization",
    "react.composition",
    "react.global-listener-ownership",
    "react.immutable-array-operations",
    "react.intentional-activity",
    "react.use-effect-event",
    "reuse.repository-candidate",
    "reuse.semantic-duplication",
  ];

  assert.deepEqual(catalog.rules.map((rule) => rule.id).sort(), expectedIds);
  for (const rule of catalog.rules) {
    assert.match(rule.id, /^[a-z][a-z0-9.-]+$/);
    assert.ok(rule.applicabilityCondition.length > 10);
    assert.ok(rule.counterexampleCondition.length > 10);
    assert.ok(rule.projectAuthorityPath.length > 3);
    assert.match(rule.sourceUrl, /^https:\/\/(?:react\.dev|nextjs\.org|www\.typescriptlang\.org)\//);
  }
  const effectEvent = catalog.rules.find((rule) => rule.id === "react.use-effect-event");
  assert.match(effectEvent.guidance, /Effect 안|inside Effects/i);
  assert.match(effectEvent.guidance, /child|자식/i);
  assert.match(effectEvent.guidance, /dependency|의존성/i);
  assert.match(effectEvent.guidance, /stable callback|안정 callback/i);
  assert.ok(catalog.suppressedAdvice.some((item) => item.id === "data.generic-swr"));
  assert.doesNotMatch(JSON.stringify(catalog.rules), /SWR/);
});

test("reviewer adapter는 evidence contract를 요구하고 deterministic 진단과 auto-fix를 금지한다", async () => {
  const root = fixture({
    "apps/web/src/hooks/use-existing.ts": "export const useExisting = () => true;\n",
  });
  try {
    const context = await buildReviewContext({ repoRoot: root, scope: { changedPaths: [] } });

    assert.match(context, /changed file.*line|변경 파일.*줄/i);
    assert.match(context, /existing candidate path|기존 candidate 경로/i);
    assert.match(context, /confidence|신뢰도/i);
    assert.match(context, /recommendation|권고/i);
    assert.match(context, /deterministic.*repeat|결정적.*반복/i);
    assert.match(context, /auto-fix|자동 수정/i);
    assert.match(context, /endpoint|contract/i);
    assert.match(context, /consumer count|consumer 수/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
