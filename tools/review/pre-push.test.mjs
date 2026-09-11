import assert from "node:assert/strict";
import test from "node:test";

import { runPrePush } from "./pre-push.mjs";

const update = (remoteRef) => `refs/heads/feature abc ${remoteRef} def\n`;

test("issue branch push는 검사를 돌리지 않고 통과시킨다", async () => {
  const calls = [];

  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/feature"),
      env: {},
      runAdvisory: async (baseRef) => {
        calls.push(`review:${baseRef}`);
        return { category: "success" };
      },
      warn: () => undefined,
    }),
    0,
  );

  // 병합 판정은 pull request의 CI가 한다. 여기서 같은 검사를 다시 돌리면 값을 두 번 낸다(ADR 0050 결정 3).
  assert.deepEqual(calls, []);
});

test("main 직접 push는 거절하고 pull request로 가라고 말한다", async () => {
  const warnings = [];
  const calls = [];

  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/main"),
      env: { EATBID_AI_REVIEW: "1" },
      runAdvisory: async (baseRef) => {
        calls.push(`review:${baseRef}`);
        return { category: "success" };
      },
      warn: (message) => warnings.push(message),
    }),
    1,
  );

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /workflow:pr/u);
  // 거절이 먼저다. 어차피 서버가 막을 push에 advisory 시간을 쓰지 않는다.
  assert.deepEqual(calls, []);
});

test("EATBID_AI_REVIEW를 켠 issue branch push만 advisory를 돌린다", async () => {
  const calls = [];

  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/feature"),
      env: { EATBID_AI_REVIEW: "1", EATBID_REVIEW_BASE: "HEAD~1" },
      runAdvisory: async (baseRef) => {
        calls.push(`review:${baseRef}`);
        return { category: "success" };
      },
      warn: () => undefined,
    }),
    0,
  );

  assert.deepEqual(calls, ["review:HEAD~1"]);
});

test("branch와 claim이 어긋난 push는 테스트를 돌리기 전에 막는다", async () => {
  const calls = [];
  const code = await runPrePush({
    stdin: update("refs/heads/feature"),
    env: {},
    checkClaims: async (stdin, environment) => {
      calls.push(["claims", stdin.trim(), environment]);
      return 1;
    },
    runAdvisory: async () => ({ category: "success" }),
    warn: () => undefined,
  });

  assert.equal(code, 1);
  assert.deepEqual(calls, [["claims", update("refs/heads/feature").trim(), {}]]);
});

test("advisory를 쓸 수 없어도 push를 막지 않는다", async () => {
  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/feature"),
      env: { EATBID_AI_REVIEW: "1" },
      runAdvisory: async () => ({ category: "unavailable" }),
      warn: () => undefined,
    }),
    0,
  );
});

test("명시적 opt-in은 feature push에서도 지정한 base로 AI 리뷰를 실행한다", async () => {
  const bases = [];
  const code = await runPrePush({
    stdin: update("refs/heads/feature"),
    env: { EATBID_AI_REVIEW: "1", EATBID_REVIEW_BASE: "master" },
    runAdvisory: async (baseRef) => {
      bases.push(baseRef);
      return { category: "success" };
    },
    warn: () => undefined,
  });

  assert.equal(code, 0);
  assert.deepEqual(bases, ["master"]);
});

test("advisory unavailable 경고는 provider별 시도 reason을 함께 보여 준다", async () => {
  const warnings = [];
  await runPrePush({
    stdin: update("refs/heads/feature"),
    env: { EATBID_AI_REVIEW: "1" },
    runAdvisory: async () => ({
      category: "unavailable",
      reason: "timeout",
      message: "초과",
      attempts: [
        { provider: "codex", reason: "quota-exhausted" },
        { provider: "claude", reason: "timeout" },
      ],
    }),
    warn: (message) => warnings.push(message),
  });
  assert.match(warnings.join("\n"), /codex:quota-exhausted/);
  assert.match(warnings.join("\n"), /claude:timeout/);
});

test("advisory success는 summary와 finding을 출력해 push하는 사람이 결과를 볼 수 있게 한다", async () => {
  const logs = [];
  await runPrePush({
    stdin: update("refs/heads/feature"),
    env: { EATBID_AI_REVIEW: "1" },
    runAdvisory: async () => ({
      category: "success",
      provider: "codex",
      providerVersion: "codex-cli 0.138.0",
      cached: false,
      attempts: [],
      result: {
        schemaVersion: "eatbid.ai-review/v2",
        summary: "검토 완료",
        findings: [
          { path: "a.ts", lineStart: 3, lineEnd: 3, title: "제목", body: "본문", confidence: "low" },
        ],
      },
    }),
    warn: () => undefined,
    log: (message) => logs.push(message),
  });
  assert.match(logs.join("\n"), /codex codex-cli 0\.138\.0/);
  assert.match(logs.join("\n"), /검토 완료/);
  assert.match(logs.join("\n"), /a\.ts:3 \[low\] 제목/);
});

test("claim 검사와 AI advisory는 같은 격리 환경을 전달받는다", async () => {
  const environments = [];
  const dirtyEnvironment = {
    Git_Index_File: "오염.index",
    INFISICAL_PROJECT_ID: "infisical-환경-보존",
    EATBID_AI_REVIEW: "1",
  };

  const code = await runPrePush({
    stdin: update("refs/heads/feature"),
    env: dirtyEnvironment,
    checkClaims: async (_stdin, environment) => {
      environments.push(environment ?? {});
      return 0;
    },
    runAdvisory: async (_baseRef, environment) => {
      environments.push(environment ?? {});
      return { category: "success" };
    },
    warn: () => undefined,
  });

  assert.equal(code, 0);
  assert.equal(environments.length, 2);
  for (const environment of environments) {
    assert.equal(
      Object.keys(environment).some((name) => name.toUpperCase() === "GIT_INDEX_FILE"),
      false,
    );
    assert.equal(environment.INFISICAL_PROJECT_ID, "infisical-환경-보존");
  }
});
