import assert from "node:assert/strict";
import test from "node:test";

import { REVIEW_BUDGET, formatAttempts, runAiAdvisory } from "./ai-advisory.mjs";
import { providerError } from "./review-contract.mjs";

const scope = {
  ok: true,
  category: "ready",
  baseRef: "origin/main",
  baseCommit: "a".repeat(40),
  mergeBase: "a".repeat(40),
  head: "b".repeat(40),
  changedPaths: ["apps/web/src/page.tsx"],
  pathHash: "c".repeat(64),
  diffStatHash: "d".repeat(64),
};
const finding = {
  path: "apps/web/src/page.tsx",
  lineStart: 1,
  lineEnd: 2,
  title: "재사용 검토",
  body: "기존 hook을 확인한다.",
  confidence: "high",
};
const success = (findings = []) => ({
  schemaVersion: "eatbid.ai-review/v2",
  summary: "검토 완료",
  findings,
});

function fakeProvider(name, execute, extra = {}) {
  const calls = [];
  return {
    calls,
    adapter: {
      name,
      resolveLaunch: () => ({ command: name, prefixArguments: [] }),
      resolveVersion: () => `${name}-version`,
      ...extra,
      execute: async (input) => {
        calls.push(input);
        return execute(input);
      },
    },
  };
}

function runtimeWith({ codex, claude, cache = new Map(), audits = [], now, lock } = {}) {
  return {
    inspectScope: () => scope,
    buildContext: async () => "공통 prompt",
    collectLineCounts: () => new Map([["apps/web/src/page.tsx", 10]]),
    providers: { codex: codex.adapter, claude: claude.adapter },
    withLock: lock ?? (async (_root, operation) => operation()),
    readCache: ({ identity }) => cache.get(identity.key) ?? null,
    writeCache: ({ identity, status, result }) => {
      if (status === "success") cache.set(identity.key, result);
      return true;
    },
    appendAudit: (record) => audits.push(record),
    ...(now ? { now } : {}),
  };
}

const run = (options) => runAiAdvisory({ repoRoot: "C:/repo", baseRef: "origin/main", ...options });

test("auto는 Codex의 허용된 장애 뒤 Claude로 한 번 폴백하고 같은 prompt와 schema bytes를 전달한다", async () => {
  const codex = fakeProvider("codex", () => {
    throw providerError("codex", "quota-exhausted", "소진");
  });
  const claude = fakeProvider("claude", () => success(), {
    inspectAuth: () => ({ authMethod: "claude.ai" }),
  });
  const audits = [];

  const outcome = await run({ runtime: runtimeWith({ codex, claude, audits }) });

  assert.equal(outcome.category, "success");
  assert.equal(outcome.provider, "claude");
  assert.equal(outcome.providerVersion, "claude-version");
  assert.deepEqual(outcome.attempts, [{ provider: "codex", reason: "quota-exhausted" }]);
  assert.equal(codex.calls[0].prompt, claude.calls[0].prompt);
  assert.equal(codex.calls[0].schema, claude.calls[0].schema);
  assert.match(codex.calls[0].schemaPath, /review-result\.schema\.json$/);
  assert.equal(audits.find((record) => record.provider === "codex").fallbackReason, "quota-exhausted");
  assert.equal(formatAttempts(outcome.attempts), "codex:quota-exhausted");
});

test("finding이 있는 유효한 Codex 결과는 success이며 Claude를 실행하지 않는다", async () => {
  const codex = fakeProvider("codex", () => success([finding]));
  const claude = fakeProvider("claude", () => success());

  const outcome = await run({ runtime: runtimeWith({ codex, claude }) });

  assert.equal(outcome.category, "success");
  assert.equal(outcome.provider, "codex");
  assert.equal(outcome.result.findings.length, 1);
  assert.equal(claude.calls.length, 0);
});

test("명시적 provider는 폴백하지 않고 prefer=claude는 순서만 뒤집는다", async () => {
  const codex = fakeProvider("codex", () => success());
  const claude = fakeProvider("claude", () => {
    throw providerError("claude", "timeout", "초과");
  });

  const explicit = await run({ provider: "claude", runtime: runtimeWith({ codex, claude }) });
  assert.equal(explicit.category, "unavailable");
  assert.equal(explicit.reason, "timeout");
  assert.equal(codex.calls.length, 0);

  const preferred = await run({ prefer: "claude", runtime: runtimeWith({ codex, claude }) });
  assert.equal(preferred.category, "success");
  assert.equal(preferred.provider, "codex");
  assert.deepEqual(preferred.attempts, [{ provider: "claude", reason: "timeout" }]);
});

test("allowlist 밖의 오류와 공통 context 실패는 폴백으로 숨기지 않는다", async () => {
  const codex = fakeProvider("codex", () => {
    throw new Error("분류되지 않은 wrapper 오류");
  });
  const claude = fakeProvider("claude", () => success());

  const unknown = await run({ runtime: runtimeWith({ codex, claude }) });
  assert.equal(unknown.category, "unavailable");
  assert.equal(unknown.reason, "internal-error");
  assert.equal(claude.calls.length, 0);

  const runtime = runtimeWith({ codex, claude });
  runtime.buildContext = async () => {
    throw new Error("근거 생성 실패");
  };
  const context = await run({ runtime });
  assert.equal(context.category, "unavailable");
  assert.equal(context.reason, "context-failed");
  assert.equal(codex.calls.length, 1);
});

test("잘못된 provider 요청과 dirty tree와 lock contention은 provider를 호출하지 않고 refused로 끝난다", async () => {
  const codex = fakeProvider("codex", () => success());
  const claude = fakeProvider("claude", () => success());

  const invalid = await run({ provider: "openai", runtime: runtimeWith({ codex, claude }) });
  assert.equal(invalid.category, "refused");
  assert.equal(invalid.reason, "invalid-request");

  const dirtyRuntime = runtimeWith({ codex, claude });
  dirtyRuntime.inspectScope = () => ({ ok: false, category: "dirty-tree", message: "더럽다", changedPaths: [] });
  const dirty = await run({ runtime: dirtyRuntime });
  assert.deepEqual(dirty, { category: "refused", reason: "dirty-tree", message: "더럽다" });

  const locked = new Error("잠김");
  locked.code = "EATBID_REVIEW_LOCKED";
  const contention = await run({
    runtime: runtimeWith({
      codex,
      claude,
      lock: async () => {
        throw locked;
      },
    }),
  });
  assert.equal(contention.category, "refused");
  assert.equal(contention.reason, "lock-contention");
  assert.equal(codex.calls.length + claude.calls.length, 0);
});

test("전체 시간 예산을 넘긴 뒤에는 두 번째 provider를 시작하지 않고 남은 예산만 timeout으로 준다", async () => {
  let clock = 0;
  const now = () => clock;
  const codex = fakeProvider("codex", () => {
    clock += 280_000;
    throw providerError("codex", "timeout", "초과");
  });
  const claude = fakeProvider("claude", () => success());

  const exhausted = await run({ runtime: runtimeWith({ codex, claude, now }) });
  assert.equal(exhausted.category, "unavailable");
  assert.equal(exhausted.reason, "budget-exhausted");
  assert.deepEqual(exhausted.attempts, [
    { provider: "codex", reason: "timeout" },
    { provider: "claude", reason: "budget-exhausted" },
  ]);
  assert.equal(claude.calls.length, 0);
  assert.equal(codex.calls[0].timeoutMs, REVIEW_BUDGET.providerMs);

  clock = 0;
  const slowCodex = fakeProvider("codex", () => {
    clock += 150_000;
    throw providerError("codex", "process-failed", "실패");
  });
  const outcome = await run({ runtime: runtimeWith({ codex: slowCodex, claude, now }) });
  assert.equal(outcome.category, "success");
  assert.equal(claude.calls[0].timeoutMs, 150_000);
});

test("검증된 성공은 같은 provider와 version에서만 cache로 재사용한다", async () => {
  const cache = new Map();
  const codex = fakeProvider("codex", () => success());
  const claude = fakeProvider("claude", () => success());
  const runtime = runtimeWith({ codex, claude, cache });

  const first = await run({ runtime });
  const second = await run({ runtime });
  const other = await run({ provider: "claude", runtime });

  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.equal(codex.calls.length, 1);
  assert.equal(other.cached, false);
  assert.equal(claude.calls.length, 1);
});

test("schema를 어긴 provider 출력은 invalid-output으로 폴백하고 cache하지 않는다", async () => {
  const cache = new Map();
  const codex = fakeProvider("codex", () => ({ schemaVersion: "eatbid.ai-review/v2", summary: "x", findings: [{ ...finding, path: "밖.ts" }] }));
  const claude = fakeProvider("claude", () => success());

  const outcome = await run({ runtime: runtimeWith({ codex, claude, cache }) });
  assert.equal(outcome.provider, "claude");
  assert.deepEqual(outcome.attempts, [{ provider: "codex", reason: "invalid-output" }]);
  assert.equal(cache.size, 1);
});

test("Claude 인증 doctor가 거부하면 auth-unavailable로 기록하고 실행하지 않는다", async () => {
  const codex = fakeProvider("codex", () => {
    throw providerError("codex", "missing-cli", "없음");
  });
  const claude = fakeProvider("claude", () => success(), {
    inspectAuth: () => {
      throw providerError("claude", "auth-unavailable", "구독 아님");
    },
  });
  const outcome = await run({ runtime: runtimeWith({ codex, claude }) });
  assert.equal(outcome.category, "unavailable");
  assert.equal(outcome.reason, "auth-unavailable");
  assert.equal(claude.calls.length, 0);
});
