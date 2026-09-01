/** @module 책임: 검증된 변경의 Codex 실행·결과 검증·성공 cache 정책을 조정한다. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildReviewContext, REVIEW_CONTEXT_VERSION } from "./build-review-context.mjs";
import { discoverCodex, executeCodexProcess, resolveCodexVersion } from "./codex-process.mjs";
import { inspectReviewScope } from "./git-scope.mjs";
import {
  appendReviewAudit,
  buildReviewCacheIdentity,
  readReviewCache,
  withReviewLock,
  writeReviewCache,
} from "./review-state.mjs";

export { buildChildEnvironment, buildCodexArguments } from "./codex-process.mjs";

const DEFAULT_TIMEOUT_MILLISECONDS = 180_000;
const POLICY_VERSION = "eatbid.codex-advisory/v1";
const SCHEMA_VERSION = "eatbid.codex-review/v1";
const MODEL_ID = "cli-default";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

export function validateReviewOutput(value, changedPaths, lineCounts = new Map()) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("리뷰 결과가 객체가 아닙니다.");
  const rootKeys = Object.keys(value).sort();
  if (rootKeys.join("\0") !== ["findings", "schemaVersion", "summary"].join("\0")) {
    throw new Error("리뷰 결과에 알 수 없는 필드가 있습니다.");
  }
  if (
    value.schemaVersion !== SCHEMA_VERSION ||
    typeof value.summary !== "string" ||
    value.summary.length > 2000
  ) {
    throw new Error("리뷰 결과 version 또는 summary가 유효하지 않습니다.");
  }
  if (!Array.isArray(value.findings) || value.findings.length > 50) {
    throw new Error("리뷰 finding 수가 유효하지 않습니다.");
  }
  const allowedPaths = new Set(changedPaths);
  for (const finding of value.findings) {
    if (!finding || typeof finding !== "object" || !allowedPaths.has(finding.path)) {
      throw new Error("리뷰 finding 경로가 변경 범위 밖입니다.");
    }
    const findingKeys = Object.keys(finding).sort();
    if (
      findingKeys.join("\0") !==
      ["body", "confidence", "lineEnd", "lineStart", "path", "title"].join("\0")
    ) {
      throw new Error("리뷰 finding에 알 수 없는 필드가 있습니다.");
    }
    if (
      !Number.isInteger(finding.lineStart) ||
      !Number.isInteger(finding.lineEnd) ||
      finding.lineStart < 1 ||
      finding.lineEnd < finding.lineStart
    ) {
      throw new Error("리뷰 finding 줄 범위가 유효하지 않습니다.");
    }
    const maximumLine = lineCounts.get(finding.path);
    if (Number.isInteger(maximumLine) && finding.lineEnd > maximumLine) {
      throw new Error("리뷰 finding 줄 범위가 변경 파일을 벗어났습니다.");
    }
    if (
      !["high", "medium", "low"].includes(finding.confidence) ||
      typeof finding.title !== "string" ||
      finding.title.length < 1 ||
      finding.title.length > 160 ||
      typeof finding.body !== "string" ||
      finding.body.length < 1 ||
      finding.body.length > 4000
    ) {
      throw new Error("리뷰 finding 필드가 유효하지 않습니다.");
    }
  }
  return value;
}

function defaultRuntime() {
  return {
    inspectScope: inspectReviewScope,
    buildContext: buildReviewContext,
    collectLineCounts,
    discoverBinary: discoverCodex,
    resolveCodexVersion,
    executeCodex: executeCodexProcess,
    withLock: withReviewLock,
    readCache: readReviewCache,
    writeCache: writeReviewCache,
    appendAudit: appendReviewAudit,
  };
}

function unavailable(reason, message) {
  return { category: "unavailable", reason, message };
}

function reasonFor(error) {
  return (
    {
      EATBID_REVIEW_LOCKED: "lock-contention",
      EATBID_CODEX_MISSING: "missing-cli",
      EATBID_CODEX_VERSION: "codex-version",
      EATBID_CODEX_TIMEOUT: "timeout",
      EATBID_CODEX_FAILED: "codex-failed",
    }[error?.code] ?? "invalid-output"
  );
}

function auditInput({ repoRoot, startedAt, scope, identity, status, reason, findingCount }) {
  return {
    repoRoot,
    status,
    reason,
    base: scope?.baseCommit,
    head: scope?.head,
    pathHash: scope?.pathHash,
    diffStatHash: scope?.diffStatHash,
    cacheKey: identity?.key,
    promptSha256: identity?.metadata.promptSha256,
    durationMilliseconds: Date.now() - startedAt,
    findingCount,
  };
}

/** 안전한 Git 범위만 리뷰하고, 완전히 검증된 같은 결과만 재사용한다. */
export async function runCodexAdvisory({
  repoRoot,
  baseRef,
  executable,
  timeoutMs = DEFAULT_TIMEOUT_MILLISECONDS,
  environment = process.env,
  runtime: runtimeOverrides = {},
}) {
  const startedAt = Date.now();
  const runtime = { ...defaultRuntime(), ...runtimeOverrides };
  let scope;
  try {
    scope = runtime.inspectScope({ repoRoot, baseRef });
  } catch (error) {
    runtime.appendAudit(
      auditInput({ repoRoot, startedAt, status: "unavailable", reason: "preflight-failed" }),
    );
    return unavailable("preflight-failed", `Git 리뷰 범위를 확인하지 못했습니다: ${error.message}`);
  }
  if (!scope.ok) {
    runtime.appendAudit(
      auditInput({ repoRoot, startedAt, scope, status: "unavailable", reason: scope.category }),
    );
    return unavailable(scope.category, scope.message);
  }

  let identity;
  try {
    return await runtime.withLock(repoRoot, async () => {
      const prompt = await runtime.buildContext({ repoRoot, scope });
      const schemaPath = path.join(moduleDirectory, "review-result.schema.json");
      const schema = readFileSync(schemaPath, "utf8");
      const binary = executable ?? runtime.discoverBinary(environment);
      const codexVersion = runtime.resolveCodexVersion(binary, environment);
      identity = buildReviewCacheIdentity({
        policyVersion: POLICY_VERSION,
        promptVersion: REVIEW_CONTEXT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        codexVersion,
        model: MODEL_ID,
        baseRef,
        baseCommit: scope.baseCommit,
        mergeBase: scope.mergeBase,
        head: scope.head,
        pathHash: scope.pathHash,
        diffStatHash: scope.diffStatHash,
        promptSha256: sha256(prompt),
        schemaSha256: sha256(schema),
      });
      const lineCounts = runtime.collectLineCounts(repoRoot, scope.changedPaths);
      const cached = runtime.readCache({ repoRoot, identity });
      if (cached !== null) {
        try {
          const result = validateReviewOutput(cached, scope.changedPaths, lineCounts);
          runtime.appendAudit(
            auditInput({
              repoRoot,
              startedAt,
              scope,
              identity,
              status: "cached",
              reason: null,
              findingCount: result.findings.length,
            }),
          );
          return { category: "success", cached: true, result };
        } catch {
          // 손상되거나 과거 규칙으로 검증된 cache는 실제 Codex 실행으로 대체한다.
        }
      }

      const raw = await runtime.executeCodex({
        repoRoot,
        binary,
        baseRef,
        prompt,
        schemaPath,
        timeoutMs,
        environment,
      });
      const result = validateReviewOutput(raw, scope.changedPaths, lineCounts);
      runtime.writeCache({ repoRoot, identity, status: "success", result });
      runtime.appendAudit(
        auditInput({
          repoRoot,
          startedAt,
          scope,
          identity,
          status: "success",
          reason: null,
          findingCount: result.findings.length,
        }),
      );
      return { category: "success", cached: false, result };
    });
  } catch (error) {
    const reason = reasonFor(error);
    runtime.appendAudit(
      auditInput({ repoRoot, startedAt, scope, identity, status: "unavailable", reason }),
    );
    return unavailable(reason, error?.message ?? "Codex 리뷰를 실행하지 못했습니다.");
  }
}

async function main() {
  const args = process.argv.slice(2);
  const baseIndex = args.indexOf("--base");
  const baseRef = baseIndex >= 0 ? args[baseIndex + 1] : undefined;
  if (!baseRef || baseRef.startsWith("--")) throw new Error("--base Git ref가 필요합니다.");
  const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
  const outcome = await runCodexAdvisory({ repoRoot, baseRef });
  if (outcome.category !== "success") {
    console.warn(`AI 리뷰 advisory 사용 불가: ${outcome.message}`);
    return;
  }
  console.log(outcome.cached ? `[cache 재사용] ${outcome.result.summary}` : outcome.result.summary);
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
