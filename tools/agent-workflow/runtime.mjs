/** @module 책임: 세션 cwd에서 git worktree root·common dir·현재 branch를 결정해 workflow 명령이 어느 checkout에서 도는지 한 곳에서 판정한다. */
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

function git(cwd, args, fallback = "") {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

function readTrimmed(filePath) {
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function realPathOrSelf(candidate) {
  try {
    return realpathSync.native(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

/**
 * git을 실행하지 않고 파일만 읽어 worktree root와 common dir을 찾는다. `.git`이 디렉터리면 그것이 common
 * dir이고, linked worktree의 `.git` 파일은 `gitdir:`로 가리키는 디렉터리의 `commondir` 파일이 common dir을
 * 말한다. Argo smoke는 linked worktree에서도 main checkout과 같은 저장소 루트 기준으로 overlay를 찾아야 한다.
 */
export function locateRepository(cwd) {
  let current = realPathOrSelf(cwd);
  for (;;) {
    const marker = path.join(current, ".git");
    let markerStat = null;
    try {
      markerStat = statSync(marker);
    } catch {
      markerStat = null;
    }
    if (markerStat?.isDirectory()) {
      return { commonDirectory: marker, isGitWorktree: true, worktreeRoot: current };
    }
    if (markerStat?.isFile()) {
      const pointer = readTrimmed(marker).match(/^gitdir:\s*(.+)$/m)?.[1]?.trim();
      if (!pointer) return { commonDirectory: null, isGitWorktree: false, worktreeRoot: current };
      const gitDirectory = path.resolve(current, pointer);
      const commonPointer = readTrimmed(path.join(gitDirectory, "commondir"));
      const commonDirectory = commonPointer ? path.resolve(gitDirectory, commonPointer) : gitDirectory;
      return { commonDirectory, isGitWorktree: true, worktreeRoot: current };
    }
    const parent = path.dirname(current);
    if (parent === current) return { commonDirectory: null, isGitWorktree: false, worktreeRoot: null };
    current = parent;
  }
}

export function repositoryContext(cwd) {
  const located = locateRepository(cwd);
  const worktreeRoot = located.worktreeRoot ?? path.resolve(cwd);
  return {
    branch: located.isGitWorktree ? git(worktreeRoot, ["branch", "--show-current"]) : "",
    isGitWorktree: located.isGitWorktree,
    worktreeRoot,
  };
}
