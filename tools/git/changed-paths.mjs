/** @module 책임: 변경 범위 검사들이 같은 규칙으로 merge-base와 변경 경로 집합을 얻도록 Git 조회와 범위 판정을 한 곳에 둔다. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

export const CHANGED_PATHS_ENV = "EATBID_CHANGED_PATHS";
export const CHANGED_BASE_ENV = "EATBID_CHANGED_BASE";
export const DEFAULT_BASE_CANDIDATES = Object.freeze(["main", "origin/main"]);
const compare = (left, right) => (left < right ? -1 : left > right ? 1 : 0);

function git(repoRoot, args) {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

function commitOf(repoRoot, ref) {
  try {
    return git(repoRoot, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${ref}^{commit}`]).trim() || null;
  } catch {
    return null;
  }
}

function mergeBase(repoRoot, left, right) {
  try {
    return git(repoRoot, ["merge-base", left, right]).trim() || null;
  } catch {
    return null;
  }
}

/**
 * 기준 commit을 정한다. 명시한 base가 해석되지 않으면 조용히 약해지는 대신 설정 오류로 던진다.
 * 자동 탐색은 main → origin/main 순서로 HEAD와 다른 merge-base를 먼저 취한다. 둘 다 HEAD와 같으면
 * (main 자체이거나 branch에 아직 commit이 없는 경우) HEAD가 기준이 되어 작업 트리 변경만 범위가 된다.
 * 후보 branch가 하나도 없으면 unresolved이며, 그 처리는 호출한 검사기가 정한다.
 */
export function resolveChangedBase({ repoRoot, base, candidates = DEFAULT_BASE_CANDIDATES }) {
  const root = path.resolve(repoRoot);
  const head = commitOf(root, "HEAD");
  if (!head) return { kind: "unresolved", reason: "HEAD commit이 없어 변경 범위를 정할 수 없습니다." };
  if (base !== undefined && base !== "") {
    if (/[\0\r\n]/u.test(base) || base.startsWith("-")) {
      throw new Error(`안전하지 않은 base ref입니다: ${JSON.stringify(base)}`);
    }
    const commit = commitOf(root, base);
    const merge = commit && mergeBase(root, head, commit);
    if (!merge) throw new Error(`명시한 base를 HEAD의 공통 조상으로 해석하지 못했습니다: ${base}`);
    return { kind: "explicit", ref: base, commit: merge, head };
  }
  let sawCandidate = false;
  for (const candidate of candidates) {
    const commit = commitOf(root, candidate);
    if (!commit) continue;
    const merge = mergeBase(root, head, commit);
    if (!merge) continue;
    sawCandidate = true;
    if (merge !== head) return { kind: "merge-base", ref: candidate, commit: merge, head };
  }
  if (sawCandidate) return { kind: "head", ref: "HEAD", commit: head, head };
  return {
    kind: "unresolved",
    reason: `기준 branch(${candidates.join(", ")})를 찾지 못해 변경 범위를 정할 수 없습니다.`,
  };
}

/** base 이후 추가·복사·수정·이름 변경된 추적 파일과 untracked 파일 중 지금 존재하는 경로를 정렬해 돌려준다. */
export function listChangedPaths({ repoRoot, baseCommit }) {
  const root = path.resolve(repoRoot);
  const split = (output) =>
    output
      .split("\0")
      .filter(Boolean)
      .map((item) => item.replaceAll("\\", "/"));
  const tracked = split(git(root, ["diff", "--name-only", "--diff-filter=ACMR", "-z", baseCommit, "--"]));
  const untracked = split(git(root, ["ls-files", "--others", "--exclude-standard", "-z"]));
  return [...new Set([...tracked, ...untracked])]
    .filter((item) => existsSync(path.join(root, item)))
    .sort(compare);
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * 검사기가 공유하는 범위 판정이다. 우선순위는 드라이버가 env로 넘긴 경로 목록 → `--all` → `--base`·env base →
 * 자동 탐색이다. `defaultMode`가 `all`인 검사(예외 없는 규칙을 속도 때문에만 좁히는 검사)는 `--changed`나
 * env 목록이 있을 때만 좁히고, `changed`인 검사(규칙 자체가 신규·수정 파일에 관한 검사)는 항상 기준을 찾는다.
 */
export function changedScope({ repoRoot, argv = process.argv.slice(2), env = process.env, defaultMode = "changed" }) {
  const args = argv.filter((item) => item !== "--");
  const envPaths = env[CHANGED_PATHS_ENV];
  if (args.includes("--all")) return { mode: "all" };
  if (typeof envPaths === "string") {
    return {
      mode: "changed",
      paths: new Set(envPaths.split("\n").filter(Boolean)),
      base: { kind: "driver", ref: env[CHANGED_BASE_ENV] || "(driver)" },
    };
  }
  const base = argumentValue(args, "--base") ?? (env[CHANGED_BASE_ENV] || undefined);
  if (defaultMode === "all" && !args.includes("--changed") && base === undefined) return { mode: "all" };
  const resolved = resolveChangedBase({ repoRoot, base });
  if (resolved.kind === "unresolved") return { mode: "unresolved", reason: resolved.reason };
  return {
    mode: "changed",
    paths: new Set(listChangedPaths({ repoRoot, baseCommit: resolved.commit })),
    base: resolved,
  };
}

/** 검사 결과 줄에 붙일 범위 설명이다. 기준을 어떻게 정했는지 사람이 한 줄로 읽을 수 있어야 한다. */
export function describeScope(scope) {
  if (scope.mode === "all") return "범위: 전체";
  if (scope.mode === "unresolved") return `범위: 미정(${scope.reason})`;
  const { base } = scope;
  const commit = base.commit ? `@${base.commit.slice(0, 7)}` : "";
  const origin =
    base.kind === "head"
      ? "HEAD 이후 작업 트리"
      : base.kind === "driver"
        ? `드라이버 전달(${base.ref})`
        : `${base.ref}${commit} merge-base 이후`;
  return `범위: ${origin} ${scope.paths.size}개 경로`;
}
