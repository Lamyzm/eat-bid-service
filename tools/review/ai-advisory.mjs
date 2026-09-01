/** @module 책임: provider 순서·폴백 허용 정책·전체 시간 예산·provider별 cache 재사용을 조정해 provider 중립 AI advisory 결과를 만든다. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReviewContext, REVIEW_CONTEXT_VERSION } from "./build-review-context.mjs";
import { inspectReviewScope } from "./git-scope.mjs";
import { claudeProvider } from "./providers/claude-process.mjs";
import { codexProvider } from "./providers/codex-process.mjs";
import {
  POLICY_VERSION,
  SCHEMA_VERSION,
  isProviderError,
  providerError,
  resolveProviderOrder,
  validateReviewOutput,
} from "./review-contract.mjs";
import {
  appendReviewAudit,
  buildReviewCacheIdentity,
  readReviewCache,
  withReviewLock,
  writeReviewCache,
} from "./review-state.mjs";

/**
 * 하나의 실행에 하나의 예산만 둔다. 첫 provider가 timeout해도 두 번째가 전체 상한을 다시 쓰지 않으며,
 * 남은 예산이 minimumMs 미만이면 시작하지 않는다. 기존 180초 smoke를 provider 상한으로 유지한다.
 */
export const REVIEW_BUDGET = Object.freeze({ totalMs: 300_000, providerMs: 180_000, minimumMs: 30_000 });
const DEFAULT_MODEL = "cli-default";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(moduleDirectory, "review-result.schema.json");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function collectLineCounts(repoRoot, changedPaths) {
  const counts = new Map();
  const root = path.resolve(repoRoot);
  for (const relativePath of changedPaths) {
    const target = path.resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) continue;
    if (!existsSync(target)) continue;
    const source = readFileSync(target, "utf8").replaceAll("\r\n", "\n");
    counts.set(relativePath, source.length === 0 ? 0 : source.split("\n").length);
  }
  return counts;
}

function defaultRuntime() {
  return {
    inspectScope: inspectReviewScope,
    buildContext: buildReviewContext,
    collectLineCounts,
    providers: { codex: codexProvider, claude: claudeProvider },
    withLock: withReviewLock,
    readCache: readReviewCache,
    writeCache: writeReviewCache,
    appendAudit: appendReviewAudit,
    now: Date.now,
  };
}

const refused = (reason, message) => ({ category: "refused", reason, message });
const unavailable = (reason, message, attempts = []) => ({
  category: "unavailable",
  reason,
  message,
  attempts,
});

/** 안전한 Git 범위만 리뷰하고, 허용된 provider 장애에서만 다음 provider를 시도한다. */
export async function runAiAdvisory({
  repoRoot,
  baseRef,
  provider = "auto",
  prefer,
  model = DEFAULT_MODEL,
  budget = REVIEW_BUDGET,
  environment = process.env,
  runtime: runtimeOverrides = {},
}) {
  const runtime = { ...defaultRuntime(), ...runtimeOverrides };
  const startedAt = runtime.now();
  const elapsed = () => runtime.now() - startedAt;
  const audit = (fields) =>
    runtime.appendAudit({ repoRoot, model, durationMilliseconds: elapsed(), ...fields });

  let order;
  try {
    order = resolveProviderOrder({ provider, prefer });
  } catch (error) {
    return refused("invalid-request", error.message);
  }

  let scope;
  try {
    scope = runtime.inspectScope({ repoRoot, baseRef });
  } catch (error) {
    audit({ status: "refused", reason: "preflight-failed" });
    return refused("preflight-failed", `Git 리뷰 범위를 확인하지 못했습니다: ${error.message}`);
  }
  if (!scope.ok) {
    audit({ status: "refused", reason: scope.category });
    return refused(scope.category, scope.message);
  }
  const scopeFields = {
    base: scope.baseCommit,
    head: scope.head,
    pathHash: scope.pathHash,
    diffStatHash: scope.diffStatHash,
  };

  try {
    return await runtime.withLock(repoRoot, async () => {
      let prompt;
      let schema;
      try {
        prompt = await runtime.buildContext({ repoRoot, scope });
        schema = readFileSync(schemaPath, "utf8");
      } catch (error) {
        audit({ status: "unavailable", reason: "context-failed", ...scopeFields });
        return unavailable("context-failed", `리뷰 근거를 만들지 못했습니다: ${error.message}`);
      }
      const lineCounts = runtime.collectLineCounts(repoRoot, scope.changedPaths);
      const attempts = [];

      for (const [index, name] of order.order.entries()) {
        const remaining = budget.totalMs - elapsed();
        if (remaining < budget.minimumMs) {
          attempts.push({ provider: name, reason: "budget-exhausted" });
          audit({ status: "unavailable", reason: "budget-exhausted", provider: name, ...scopeFields });
          return unavailable("budget-exhausted", "AI 리뷰 시간 예산이 소진되었습니다.", attempts);
        }
        const hasNext = order.mode === "auto" && index < order.order.length - 1;
        const adapter = runtime.providers[name];
        let providerVersion = null;
        let identity = null;
        try {
          const launch = adapter.resolveLaunch(environment);
          providerVersion = adapter.resolveVersion(launch, environment);
          adapter.inspectAuth?.(launch, environment);
          identity = buildReviewCacheIdentity({
            policyVersion: POLICY_VERSION,
            promptVersion: REVIEW_CONTEXT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            provider: name,
            providerVersion,
            model,
            baseRef,
            baseCommit: scope.baseCommit,
            mergeBase: scope.mergeBase,
            head: scope.head,
            pathHash: scope.pathHash,
            diffStatHash: scope.diffStatHash,
            promptSha256: sha256(prompt),
            schemaSha256: sha256(schema),
          });
          const common = {
            provider: name,
            providerVersion,
            cacheKey: identity.key,
            promptSha256: identity.metadata.promptSha256,
            ...scopeFields,
          };

          const cached = runtime.readCache({ repoRoot, identity });
          if (cached !== null) {
            try {
              const result = validateReviewOutput(cached, scope.changedPaths, lineCounts);
              audit({ status: "cached", reason: null, findingCount: result.findings.length, ...common });
              return { category: "success", provider: name, providerVersion, model, cached: true, result, attempts };
            } catch {
              // 손상되거나 과거 규칙으로 검증된 cache는 실제 실행으로 대체한다.
            }
          }

          const raw = await adapter.execute({
            repoRoot,
            launch,
            prompt,
            schema,
            schemaPath,
            model: model === DEFAULT_MODEL ? undefined : model,
            timeoutMs: Math.min(budget.providerMs, remaining),
            environment,
          });
          let result;
          try {
            result = validateReviewOutput(raw, scope.changedPaths, lineCounts);
          } catch (error) {
            throw providerError(name, "invalid-output", error.message);
          }
          runtime.writeCache({ repoRoot, identity, status: "success", result });
          audit({ status: "success", reason: null, findingCount: result.findings.length, ...common });
          return { category: "success", provider: name, providerVersion, model, cached: false, result, attempts };
        } catch (error) {
          if (!isProviderError(error)) {
            audit({ status: "unavailable", reason: "internal-error", provider: name, providerVersion, ...scopeFields });
            return unavailable("internal-error", error?.message ?? "AI 리뷰 wrapper 내부 오류", attempts);
          }
          attempts.push({ provider: name, reason: error.reason });
          audit({
            status: "unavailable",
            reason: error.reason,
            provider: name,
            providerVersion,
            fallbackReason: hasNext ? error.reason : null,
            cacheKey: identity?.key ?? null,
            ...scopeFields,
          });
          if (!hasNext) return unavailable(error.reason, error.message, attempts);
        }
      }
      return unavailable(attempts.at(-1)?.reason ?? "internal-error", "시도 가능한 provider가 없습니다.", attempts);
    });
  } catch (error) {
    if (error?.code === "EATBID_REVIEW_LOCKED") {
      audit({ status: "refused", reason: "lock-contention", ...scopeFields });
      return refused("lock-contention", error.message);
    }
    audit({ status: "unavailable", reason: "internal-error", ...scopeFields });
    return unavailable("internal-error", error?.message ?? "AI 리뷰 wrapper 내부 오류");
  }
}

export function formatAttempts(attempts = []) {
  return attempts.map((attempt) => `${attempt.provider}:${attempt.reason}`).join(" → ");
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  const value = index >= 0 ? args[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const baseRef = argumentValue(args, "--base");
  if (!baseRef) throw new Error("--base Git ref가 필요합니다.");
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const outcome = await runAiAdvisory({
    repoRoot,
    baseRef,
    provider: argumentValue(args, "--provider") ?? "auto",
    prefer: argumentValue(args, "--prefer"),
    model: argumentValue(args, "--model") ?? DEFAULT_MODEL,
  });
  const trail = formatAttempts(outcome.attempts);
  if (outcome.category !== "success") {
    console.warn(
      `AI 리뷰 advisory 사용 불가 (${outcome.category}/${outcome.reason}${trail ? `; ${trail}` : ""}): ${outcome.message}`,
    );
    return;
  }
  const header = [
    `${outcome.provider} ${outcome.providerVersion}`,
    outcome.cached ? "cache 재사용" : null,
    trail ? `이전 시도 ${trail}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  console.log(`[${header}] ${outcome.result.summary}`);
  for (const finding of outcome.result.findings) {
    console.log(
      `- ${finding.path}:${finding.lineStart} [${finding.confidence}] ${finding.title}\n  ${finding.body}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.warn(`AI 리뷰 advisory 사용 불가: ${error.message}`);
  });
}
