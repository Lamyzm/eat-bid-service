import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildChildEnvironment,
  buildCodexArguments,
  runCodexAdvisory,
  validateReviewOutput,
} from "./codex-advisory.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

test("Codex 구조화 출력 schema는 const와 enum에도 명시적인 JSON type을 둔다", () => {
  const schema = JSON.parse(readFileSync(path.join(toolRoot, "review-result.schema.json"), "utf8"));

  assert.equal(schema.properties.schemaVersion.type, "string");
  assert.equal(schema.properties.findings.items.properties.confidence.type, "string");
});

test("Codex를 custom prompt와 호환되는 read-only ephemeral exec argv로만 실행한다", () => {
  assert.deepEqual(
    buildCodexArguments({
      baseRef: "master",
      schemaPath: "C:/tmp/schema.json",
      outputPath: "C:/tmp/result.json",
    }),
    [
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema",
      "C:/tmp/schema.json",
      "--json",
      "--output-last-message",
      "C:/tmp/result.json",
      "-",
    ],
  );
});

test("child 환경은 실행과 인증에 필요한 값만 허용하고 secret을 제거한다", () => {
  const child = buildChildEnvironment({
    PATH: "bin",
    SystemRoot: "C:/Windows",
    USERPROFILE: "C:/Users/test",
    CODEX_HOME: "C:/Users/test/.codex",
    DATABASE_URL: "secret",
    INFISICAL_TOKEN: "secret",
    LINEAR_API_KEY: "secret",
  });

  assert.deepEqual(child, {
    PATH: "bin",
    SystemRoot: "C:/Windows",
    USERPROFILE: "C:/Users/test",
    CODEX_HOME: "C:/Users/test/.codex",
  });
});

test("구조화 결과는 변경 경로와 유효한 줄 범위 및 최대 finding 수를 강제한다", () => {
  const valid = {
    schemaVersion: "eatbid.codex-review/v1",
    summary: "검토 완료",
    findings: [
      {
        path: "apps/web/src/page.tsx",
        lineStart: 2,
        lineEnd: 3,
        title: "기존 hook 재사용 검토",
        body: "기존 경로를 확인한다.",
        confidence: "medium",
      },
    ],
  };
  assert.deepEqual(validateReviewOutput(valid, ["apps/web/src/page.tsx"]), valid);
  assert.throws(() =>
    validateReviewOutput({ ...valid, findings: [{ ...valid.findings[0], path: "unknown.ts" }] }, [
      "apps/web/src/page.tsx",
    ]),
  );
  assert.throws(() =>
    validateReviewOutput(
      { ...valid, findings: [{ ...valid.findings[0], lineStart: 4, lineEnd: 3 }] },
      ["apps/web/src/page.tsx"],
    ),
  );
  assert.throws(() =>
    validateReviewOutput(
      { ...valid, findings: Array.from({ length: 51 }, () => valid.findings[0]) },
      ["apps/web/src/page.tsx"],
    ),
  );
  assert.throws(() =>
    validateReviewOutput(valid, ["apps/web/src/page.tsx"], new Map([["apps/web/src/page.tsx", 2]])),
  );
  assert.throws(() =>
    validateReviewOutput({ ...valid, summary: "가".repeat(2001) }, ["apps/web/src/page.tsx"]),
  );
  assert.throws(() =>
    validateReviewOutput(
      {
        ...valid,
        findings: [{ ...valid.findings[0], title: "", body: "가".repeat(4001) }],
      },
      ["apps/web/src/page.tsx"],
    ),
  );
});

test("검증 성공 결과를 같은 변경에서 재사용하고 Codex 중복 실행을 막는다", async () => {
  const scope = {
    ok: true,
    baseRef: "origin/main",
    baseCommit: "a".repeat(40),
    mergeBase: "a".repeat(40),
    head: "b".repeat(40),
    changedPaths: ["apps/web/src/page.tsx"],
    pathHash: "c".repeat(64),
    diffStatHash: "d".repeat(64),
  };
  const result = {
    schemaVersion: "eatbid.codex-review/v1",
    summary: "검토 완료",
    findings: [],
  };
  let cached = null;
  let executions = 0;
  const runtime = {
    inspectScope: () => scope,
    buildContext: async () => "검증 prompt",
    collectLineCounts: () => new Map([["apps/web/src/page.tsx", 10]]),
    discoverBinary: () => "codex",
    resolveCodexVersion: () => "codex-cli 1.2.3",
    executeCodex: async ({ prompt }) => {
      executions += 1;
      assert.equal(prompt, "검증 prompt");
      return result;
    },
    withLock: async (_repoRoot, operation) => operation(),
    readCache: () => cached,
    writeCache: ({ status, result: value }) => {
      assert.equal(status, "success");
      cached = value;
      return true;
    },
    appendAudit: () => undefined,
  };

  const first = await runCodexAdvisory({
    repoRoot: "C:/repo",
    baseRef: "origin/main",
    runtime,
  });
  const second = await runCodexAdvisory({
    repoRoot: "C:/repo",
    baseRef: "origin/main",
    runtime,
  });

  assert.equal(first.category, "success");
  assert.equal(first.cached, false);
  assert.equal(second.category, "success");
  assert.equal(second.cached, true);
  assert.equal(executions, 1);
});
