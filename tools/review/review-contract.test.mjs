import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  FALLBACK_REASONS,
  PROVIDERS,
  SCHEMA_VERSION,
  isProviderError,
  providerError,
  resolveProviderOrder,
  validateReviewOutput,
} from "./review-contract.mjs";

const toolRoot = path.dirname(fileURLToPath(import.meta.url));

test("auto는 codex → claude 순서이고 prefer=claude만 순서를 뒤집는다", () => {
  assert.deepEqual(resolveProviderOrder({}), { mode: "auto", order: ["codex", "claude"] });
  assert.deepEqual(resolveProviderOrder({ provider: "auto", prefer: "claude" }), {
    mode: "auto",
    order: ["claude", "codex"],
  });
  assert.deepEqual(resolveProviderOrder({ provider: "codex" }), { mode: "explicit", order: ["codex"] });
  assert.deepEqual(resolveProviderOrder({ provider: "claude" }), { mode: "explicit", order: ["claude"] });
});

test("알 수 없는 provider나 prefer 값은 계약 오류로 거부한다", () => {
  assert.throws(() => resolveProviderOrder({ provider: "openai" }), /provider/);
  assert.throws(() => resolveProviderOrder({ provider: "auto", prefer: "gemini" }), /prefer/);
  assert.throws(() => resolveProviderOrder({ provider: "codex", prefer: "claude" }), /prefer/);
  assert.deepEqual([...PROVIDERS], ["codex", "claude"]);
});

test("provider 오류는 allowlist reason에서만 폴백을 허용한다", () => {
  const quota = providerError("codex", "quota-exhausted", "사용량이 소진되었습니다.");
  assert.equal(quota.code, "EATBID_PROVIDER_ERROR");
  assert.equal(quota.provider, "codex");
  assert.equal(quota.fallbackAllowed, true);
  assert.equal(isProviderError(quota), true);
  assert.equal(isProviderError(new Error("일반 오류")), false);
  assert.throws(() => providerError("claude", "dirty-tree", "허용되지 않는 reason"), /reason/);
  assert.deepEqual([...FALLBACK_REASONS].sort(), [
    "auth-unavailable",
    "cli-version",
    "invalid-output",
    "missing-cli",
    "process-failed",
    "provider-overloaded",
    "quota-exhausted",
    "rate-limited",
    "timeout",
    "tool-failed",
  ]);
});

test("결과 schema와 검증기는 provider 중립 v2 version을 사용한다", () => {
  const schema = JSON.parse(readFileSync(path.join(toolRoot, "review-result.schema.json"), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "eatbid.ai-review/v2");
  assert.equal(SCHEMA_VERSION, "eatbid.ai-review/v2");
  assert.equal(schema.properties.schemaVersion.type, "string");
  assert.equal(schema.properties.findings.items.properties.confidence.type, "string");
});

test("구조화 결과는 변경 경로와 유효한 줄 범위 및 최대 finding 수를 강제한다", () => {
  const valid = {
    schemaVersion: "eatbid.ai-review/v2",
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
  const changed = ["apps/web/src/page.tsx"];
  assert.deepEqual(validateReviewOutput(valid, changed), valid);
  assert.throws(() =>
    validateReviewOutput({ ...valid, schemaVersion: "eatbid.codex-review/v1" }, changed),
  );
  assert.throws(() =>
    validateReviewOutput({ ...valid, findings: [{ ...valid.findings[0], path: "unknown.ts" }] }, changed),
  );
  assert.throws(() =>
    validateReviewOutput(
      { ...valid, findings: [{ ...valid.findings[0], lineStart: 4, lineEnd: 3 }] },
      changed,
    ),
  );
  assert.throws(() =>
    validateReviewOutput(
      { ...valid, findings: Array.from({ length: 51 }, () => valid.findings[0]) },
      changed,
    ),
  );
  assert.throws(() =>
    validateReviewOutput(valid, changed, new Map([["apps/web/src/page.tsx", 2]])),
  );
  assert.throws(() => validateReviewOutput({ ...valid, summary: "가".repeat(2001) }, changed));
  assert.throws(() =>
    validateReviewOutput(
      { ...valid, findings: [{ ...valid.findings[0], title: "", body: "가".repeat(4001) }] },
      changed,
    ),
  );
});
