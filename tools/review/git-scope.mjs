/** @module 책임: AI 리뷰 전에 Git 범위와 prompt 반입 금지 경계를 결정한다. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";

export const REVIEW_SCOPE_LIMITS = Object.freeze({
  files: 100,
  changedLines: 6_000,
  patchBytes: 1024 * 1024,
});

export const DENIED_PATH =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:secret|credential)[^/]*)(?:\/|$)|(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock)$|(?:^|\/)(?:node_modules|dist|\.next|generated)(?:\/|$)/i;
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
  // finding 대상은 현재 존재하는 파일(ACMR)뿐이지만 patch에는 삭제 파일 본문도 남는다.
  // 그래서 민감 경로 거부는 삭제를 포함한 전체 변경 경로에 적용한다.
  if (listPaths([]).some((value) => DENIED_PATH.test(value))) {
    return refused("denied-path", "민감 정보·생성물·lockfile 변경은 AI prompt에 넣지 않습니다.");
  }
  const changedPaths = listPaths(["--diff-filter=ACMR"]);
  if (changedPaths.length > limits.files) {
    return refused("too-many-files", `변경 파일이 ${limits.files}개를 초과했습니다.`);
  }

  const numstat = git(root, ["diff", "--numstat", range]);
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
    patch = git(root, ["-c", "core.quotePath=false", "diff", "--binary", "--no-ext-diff", range]);
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
    changedLines,
    patchBytes,
    patch,
    pathHash: hash(changedPaths.join("\0")),
    diffStatHash: hash(numstat),
  };
}
