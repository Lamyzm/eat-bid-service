/** @module 책임: AI 리뷰 전에 Git 범위와 prompt 반입 금지 경계를 결정한다. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export const REVIEW_SCOPE_LIMITS = Object.freeze({
  files: 100,
  changedLines: 6_000,
  patchBytes: 1024 * 1024,
});

// secret·credential은 값이 유출되면 사고이므로 range에 하나라도 있으면 전체 리뷰를 fail-closed로 거부한다.
export const SECRET_PATH = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:secret|credential)[^/]*)(?:\/|$)/i;
// lockfile·생성물은 값 유출이 아니라 소음이므로 거부하지 않고 리뷰 대상·patch·크기 계산에서만 제외한다.
export const BUILD_ARTIFACT_PATH =
  /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|(?:^|\/)(?:node_modules|dist|\.next|generated)(?:\/|$)/i;
// review-diff는 prompt 반입 금지 경계를 이 union으로 한 번 더 강제한다. 두 정규식의 합집합이라 기존 판정과 동일하다.
export const DENIED_PATH = new RegExp(`${SECRET_PATH.source}|${BUILD_ARTIFACT_PATH.source}`, "i");
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function git(root, args, options = {}) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function refused(category, message) {
  return { ok: false, category, message, changedPaths: [] };
}

/** Codex가 저장소를 읽기 전에 base·크기·민감 경로를 fail-closed로 검증한다. */
export function inspectReviewScope({ repoRoot, baseRef, limits = REVIEW_SCOPE_LIMITS }) {
  const root = path.resolve(repoRoot);
  if (
    typeof baseRef !== "string" ||
    baseRef.length === 0 ||
    baseRef.length > 255 ||
    baseRef.startsWith("-") ||
    /[\0\r\n]/u.test(baseRef)
  ) {
    return refused("invalid-base", "안전한 branch 또는 commit base ref가 필요합니다.");
  }
  if (git(root, ["status", "--porcelain=v1", "-z"]).length > 0) {
    return refused("dirty-tree", "작업 트리가 깨끗하지 않아 AI 리뷰를 건너뜁니다.");
  }

  let baseCommit;
  let head;
  try {
    baseCommit = git(root, [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${baseRef}^{commit}`,
    ]).trim();
    head = git(root, ["rev-parse", "--verify", "HEAD^{commit}"]).trim();
    execFileSync("git", ["merge-base", "--is-ancestor", baseCommit, head], {
      cwd: root,
      stdio: "ignore",
    });
  } catch {
    return refused("invalid-base", `유효한 ancestor base가 아닙니다: ${baseRef}`);
  }

  const range = `${baseCommit}...${head}`;
  const listPaths = (filterArguments) =>
    git(root, ["diff", "--name-only", ...filterArguments, "-z", range])
      .split("\0")
      .filter(Boolean)
      .map((value) => value.replaceAll("\\", "/"))
      .sort(compare);
  // finding 대상은 현재 존재하는 파일(ACMR)뿐이지만 patch에는 삭제·rename 전 본문도 남는다.
  // 그래서 경로 판정은 rename 감지를 끄고 삭제·old 경로까지 포함한 전체 변경 경로에 적용한다.
  const allPaths = listPaths(["--no-renames"]);
  // secret·credential은 값이 새면 사고이므로 range에 하나라도 있으면 전체를 거부한다(기존 포스처 유지).
  if (allPaths.some((value) => SECRET_PATH.test(value))) {
    return refused("denied-path", "민감 정보(secret·credential)는 AI prompt에 넣지 않습니다.");
  }
  // lockfile·생성물은 거부하지 않고 리뷰 대상·patch·numstat에서만 뺀다. 소음이라 리뷰 가치가 없고 크기만 키운다.
  const excludedArtifactPaths = allPaths.filter((value) => BUILD_ARTIFACT_PATH.test(value));
  const changedPaths = listPaths(["--diff-filter=ACMR"]).filter((value) => !BUILD_ARTIFACT_PATH.test(value));
  if (changedPaths.length === 0) {
    return refused(
      "no-reviewable-change",
      excludedArtifactPaths.length
        ? "생성물·lockfile만 바뀌어 리뷰할 코드 변경이 없습니다."
        : "리뷰할 변경이 없습니다.",
    );
  }
  if (changedPaths.length > limits.files) {
    return refused("too-many-files", `변경 파일이 ${limits.files}개를 초과했습니다.`);
  }
  // positive `.`에 exclude pathspec을 더해 생성물 본문을 patch·numstat에서 뺀다. literal·top으로 glob·상대경로
  // 오해를 막고, artifact가 없으면 pathspec을 비워 기존 range 동작을 그대로 유지한다.
  const artifactPathspec = excludedArtifactPaths.length
    ? ["--", ".", ...excludedArtifactPaths.map((value) => `:(exclude,literal,top)${value}`)]
    : [];

  const numstat = git(root, ["diff", "--numstat", range, ...artifactPathspec]);
  const changedLines = numstat
    .split("\n")
    .filter(Boolean)
    .reduce((total, line) => {
      const [added, deleted] = line.split("\t");
      return total + (Number.parseInt(added, 10) || 0) + (Number.parseInt(deleted, 10) || 0);
    }, 0);
  if (changedLines > limits.changedLines) {
    return refused("too-many-lines", `변경 줄이 ${limits.changedLines}줄을 초과했습니다.`);
  }

  let patch;
  try {
    // quotePath 기본값은 비ASCII 경로를 "a/..."로 감싸 header 파싱을 깨뜨리므로 저장소 설정과 무관하게 끈다.
    patch = git(root, ["-c", "core.quotePath=false", "diff", "--binary", "--no-ext-diff", range, ...artifactPathspec]);
  } catch {
    return refused("patch-too-large", `patch가 ${limits.patchBytes}바이트를 초과했습니다.`);
  }
  const patchBytes = Buffer.byteLength(patch, "utf8");
  if (patchBytes > limits.patchBytes) {
    return refused("patch-too-large", `patch가 ${limits.patchBytes}바이트를 초과했습니다.`);
  }

  return {
    ok: true,
    category: "ready",
    baseRef,
    baseCommit,
    mergeBase: git(root, ["merge-base", baseCommit, head]).trim(),
    head,
    changedPaths,
    excludedArtifactPaths,
    changedLines,
    patchBytes,
    patch,
    pathHash: hash(changedPaths.join("\0")),
    diffStatHash: hash(numstat),
  };
}
