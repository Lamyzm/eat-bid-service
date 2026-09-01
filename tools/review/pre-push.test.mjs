import assert from "node:assert/strict";
import test from "node:test";

import { runPrePush } from "./pre-push.mjs";

const update = (remoteRef) => `refs/heads/feature abc ${remoteRef} def\n`;

test("모든 push에 필수 테스트를 실행하고 main에만 아키텍처와 AI 리뷰를 더한다", async () => {
  const calls = [];
  const dependencies = {
    runRequired: async (command) => {
      calls.push(command);
      return 0;
    },
    runAdvisory: async (baseRef) => {
      calls.push(`review:${baseRef}`);
      return { category: "success" };
    },
    warn: () => undefined,
  };

  assert.equal(
    await runPrePush({ stdin: update("refs/heads/feature"), env: {}, ...dependencies }),
    0,
  );
  assert.deepEqual(calls, ["test"]);

  calls.length = 0;
  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/main"),
      env: { EATBID_REVIEW_BASE: "HEAD~1" },
      ...dependencies,
    }),
    0,
  );
  assert.deepEqual(calls, ["test", "architecture:check", "review:origin/main"]);
});

test("필수 명령 실패는 push를 막고 advisory unavailable은 막지 않는다", async () => {
  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/main"),
      env: {},
      runRequired: async (command) => (command === "architecture:check" ? 1 : 0),
      runAdvisory: async () => ({ category: "success" }),
      warn: () => undefined,
    }),
    1,
  );
  assert.equal(
    await runPrePush({
      stdin: update("refs/heads/main"),
      env: {},
      runRequired: async () => 0,
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
    runRequired: async () => 0,
    runAdvisory: async (baseRef) => {
      bases.push(baseRef);
      return { category: "success" };
    },
    warn: () => undefined,
  });

  assert.equal(code, 0);
  assert.deepEqual(bases, ["master"]);
});

test("필수 gate와 AI advisory는 같은 격리 환경을 전달받는다", async () => {
  const environments = [];
  const dirtyEnvironment = {
    Git_Index_File: "오염.index",
    INFISICAL_PROJECT_ID: "infisical-환경-보존",
  };

  const code = await runPrePush({
    stdin: update("refs/heads/main"),
    env: dirtyEnvironment,
    runRequired: async (_command, environment) => {
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
  assert.equal(environments.length, 3);
  for (const environment of environments) {
    assert.equal(
      Object.keys(environment).some((name) => name.toUpperCase() === "GIT_INDEX_FILE"),
      false,
    );
    assert.equal(environment.INFISICAL_PROJECT_ID, "infisical-환경-보존");
  }
});
