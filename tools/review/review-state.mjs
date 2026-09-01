/** @module 책임: AI 리뷰의 Git 공용 잠금·provider별 성공 캐시·비밀 없는 감사 기록을 소유한다. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const STATE_DIRECTORY = "eatbid-code-review";
const CACHE_VERSION = "eatbid.ai-review-cache/v2";
const IDENTITY_FIELDS = Object.freeze([
  "policyVersion",
  "promptVersion",
  "schemaVersion",
  "provider",
  "providerVersion",
  "model",
  "baseRef",
  "baseCommit",
  "mergeBase",
  "head",
  "pathHash",
  "diffStatHash",
  "promptSha256",
  "schemaSha256",
]);

function gitCommonDirectory(repoRoot) {
  const value = execFileSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return path.resolve(repoRoot, value);
}

function stateDirectory(repoRoot) {
  return path.join(gitCommonDirectory(repoRoot), STATE_DIRECTORY);
}

/** 동일한 변경과 정책·provider 조합만 캐시를 공유하도록 모든 권위 값을 hash한다. */
export function buildReviewCacheIdentity(input) {
  const metadata = {};
  for (const field of IDENTITY_FIELDS) {
    if (typeof input[field] !== "string" || input[field].length === 0) {
      throw new Error(`리뷰 cache identity에 ${field}가 필요합니다.`);
    }
    metadata[field] = input[field];
  }
  const key = createHash("sha256").update(JSON.stringify(metadata)).digest("hex");
  return { key, metadata };
}

function cachePath(repoRoot, identity) {
  if (!/^[a-f0-9]{64}$/u.test(identity.key)) throw new Error("리뷰 cache key가 유효하지 않습니다.");
  return path.join(stateDirectory(repoRoot), "cache", `${identity.key}.json`);
}

/** 동일 key의 검증 성공 결과만 반환하며 손상되거나 다른 형식인 cache는 사용하지 않는다. */
export function readReviewCache({ repoRoot, identity }) {
  try {
    const envelope = JSON.parse(readFileSync(cachePath(repoRoot, identity), "utf8"));
    if (
      envelope?.version !== CACHE_VERSION ||
      envelope?.key !== identity.key ||
      envelope?.status !== "success"
    ) {
      return null;
    }
    return envelope.result ?? null;
  } catch {
    return null;
  }
}

/** unavailable·미검증 결과가 재사용되지 않도록 success만 원자적 신규 파일로 기록한다. */
export function writeReviewCache({ repoRoot, identity, status, result }) {
  if (status !== "success") return false;
  const target = cachePath(repoRoot, identity);
  mkdirSync(path.dirname(target), { recursive: true });
  try {
    writeFileSync(
      target,
      `${JSON.stringify({
        version: CACHE_VERSION,
        key: identity.key,
        metadata: identity.metadata,
        status,
        result,
      })}\n`,
      { encoding: "utf8", flag: "wx" },
    );
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  return true;
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function recoverStaleLock(lockPath) {
  let owner = null;
  try {
    owner = JSON.parse(readFileSync(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    // owner 파일이 없거나 손상된 직후의 race는 아래 age 기준으로 보수적으로 판정한다.
  }
  const ageMilliseconds = Math.max(
    0,
    Date.now() -
      (Number.isFinite(Date.parse(owner?.createdAt))
        ? Date.parse(owner.createdAt)
        : statSync(lockPath).mtimeMs),
  );
  const ownerAlive = processIsAlive(owner?.pid);
  if ((ownerAlive && ageMilliseconds < 10 * 60_000) || (!owner && ageMilliseconds < 10_000))
    return false;

  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  renameSync(lockPath, `${lockPath}.recovered-${timestamp}`);
  return true;
}

/** 동시에 두 provider process가 같은 저장소 evidence를 소비하지 않도록 fail-fast 잠금을 건다. */
export async function withReviewLock(repoRoot, operation) {
  const directory = stateDirectory(repoRoot);
  const lockPath = path.join(directory, "run.lock");
  mkdirSync(directory, { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < 2 && !acquired; attempt += 1) {
    try {
      mkdirSync(lockPath);
      acquired = true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (attempt === 0 && recoverStaleLock(lockPath)) continue;
      const unavailable = new Error("다른 AI 리뷰가 이 저장소에서 실행 중입니다.");
      unavailable.code = "EATBID_REVIEW_LOCKED";
      throw unavailable;
    }
  }

  try {
    writeFileSync(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({ createdAt: new Date().toISOString(), pid: process.pid })}\n`,
      "utf8",
    );
    return await operation();
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/** 감사 로그는 allowlist metadata만 직렬화해 prompt·patch·환경·원문 결과 유출을 막는다. */
export function appendReviewAudit(input) {
  try {
    const targetDirectory = stateDirectory(input.repoRoot);
    mkdirSync(targetDirectory, { recursive: true });
    const record = {
      schemaVersion: "eatbid.ai-review-audit/v2",
      recordedAt: new Date().toISOString(),
      status: input.status,
      reason: input.reason ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      providerVersion: input.providerVersion ?? null,
      fallbackReason: input.fallbackReason ?? null,
      base: input.base ?? null,
      head: input.head ?? null,
      pathHash: input.pathHash ?? null,
      diffStatHash: input.diffStatHash ?? null,
      cacheKey: input.cacheKey ?? null,
      promptSha256: input.promptSha256 ?? null,
      durationMilliseconds: input.durationMilliseconds,
      findingCount: input.findingCount ?? null,
    };
    appendFileSync(
      path.join(targetDirectory, "audit.jsonl"),
      `${JSON.stringify(record)}\n`,
      "utf8",
    );
  } catch {
    // advisory 감사 실패가 필수 테스트 결과나 push 자체를 바꾸지는 않는다.
  }
}
