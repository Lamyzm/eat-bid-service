/** @module 책임: 두 리뷰 provider의 실행 파일·version·인증 방식을 비밀 없이 진단해 사용 가능 여부를 보고한다. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { claudeProvider } from "./providers/claude-process.mjs";
import { codexProvider } from "./providers/codex-process.mjs";
import { isProviderError } from "./review-contract.mjs";

/** 이름만 보고한다. 값이 있다는 사실이 무과금 guard가 제거할 대상임을 알려 주지만 값 자체는 출력하지 않는다. */
const BLOCKED_ENVIRONMENT =
  /^(?:ANTHROPIC_|CLAUDE_CODE_OAUTH_TOKEN$|CLAUDE_CODE_USE_(?:BEDROCK|VERTEX|FOUNDRY)$|AWS_(?:ACCESS_KEY_ID|SECRET_ACCESS_KEY|SESSION_TOKEN|PROFILE|REGION|BEARER_TOKEN_BEDROCK)$|GOOGLE_APPLICATION_CREDENTIALS$|GOOGLE_CLOUD_|CLOUD_ML_REGION$|AZURE_(?:OPENAI|AI|CLIENT|TENANT)_)/i;

function inspectProvider(adapter, environment) {
  const withAuth = typeof adapter.inspectAuth === "function";
  try {
    const launch = adapter.resolveLaunch(environment);
    const version = adapter.resolveVersion(launch, environment);
    const auth = withAuth ? adapter.inspectAuth(launch, environment) : undefined;
    return { available: true, version, reason: null, ...(withAuth ? { auth } : {}) };
  } catch (error) {
    const reason = isProviderError(error) ? error.reason : "internal-error";
    return { available: false, version: null, reason, ...(withAuth ? { auth: null } : {}) };
  }
}

export function inspectReviewProviders({
  environment = process.env,
  providers = { codex: codexProvider, claude: claudeProvider },
} = {}) {
  return {
    codex: inspectProvider(providers.codex, environment),
    claude: inspectProvider(providers.claude, environment),
    blockedEnvironmentNames: Object.keys(environment)
      .filter((name) => BLOCKED_ENVIRONMENT.test(name))
      .sort(),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(inspectReviewProviders(), null, 2)}\n`);
}
