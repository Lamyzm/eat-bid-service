import assert from "node:assert/strict";
import test from "node:test";

import { providerError } from "./review-contract.mjs";
import { inspectReviewProviders } from "./review-doctor.mjs";

test("review doctor는 provider별 실행 가능성과 인증 방식만 비밀 없이 보고한다", () => {
  const report = inspectReviewProviders({
    environment: { PATH: "bin", ANTHROPIC_API_KEY: "sk-secret", CLAUDE_CODE_USE_BEDROCK: "1" },
    providers: {
      codex: {
        resolveLaunch: () => ({ command: "C:/node.exe", prefixArguments: ["codex.js"] }),
        resolveVersion: () => "codex-cli 0.138.0",
      },
      claude: {
        resolveLaunch: () => ({ command: "claude.exe", prefixArguments: [] }),
        resolveVersion: () => "2.1.257 (Claude Code)",
        inspectAuth: () => ({ authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" }),
      },
    },
  });
  assert.deepEqual(report.codex, { available: true, version: "codex-cli 0.138.0", reason: null });
  assert.deepEqual(report.claude, {
    available: true,
    version: "2.1.257 (Claude Code)",
    reason: null,
    auth: { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" },
  });
  assert.deepEqual(report.blockedEnvironmentNames, ["ANTHROPIC_API_KEY", "CLAUDE_CODE_USE_BEDROCK"]);
  assert.doesNotMatch(JSON.stringify(report), /sk-secret/);
});

test("review doctor는 provider 오류를 reason으로 보고하고 예외를 전파하지 않는다", () => {
  const report = inspectReviewProviders({
    environment: {},
    providers: {
      codex: {
        resolveLaunch: () => {
          throw providerError("codex", "missing-cli", "없음");
        },
        resolveVersion: () => "x",
      },
      claude: {
        resolveLaunch: () => ({ command: "claude", prefixArguments: [] }),
        resolveVersion: () => "2.1.257 (Claude Code)",
        inspectAuth: () => {
          throw providerError("claude", "auth-unavailable", "구독 아님");
        },
      },
    },
  });
  assert.deepEqual(report.codex, { available: false, version: null, reason: "missing-cli" });
  assert.equal(report.claude.available, false);
  assert.equal(report.claude.reason, "auth-unavailable");
  assert.equal(report.claude.auth, null);
});
