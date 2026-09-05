/** @module 책임: 세션 cwd 또는 `--worktree` 대상에서 git worktree root·branch·공유 state 경로를 결정하고 Linear client를 만든다. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createLinearClient } from "./linear.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));

export const config = JSON.parse(readFileSync(path.join(scriptDirectory, "config.json"), "utf8"));

function git(cwd, args, fallback = "") {
  try {
    return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
  } catch {
    return fallback;
  }
}

export function repositoryContext(cwd) {
  const toplevel = git(cwd, ["rev-parse", "--show-toplevel"]);
  const worktreeRoot = toplevel || path.resolve(cwd);
  const gitCommonDirectory = git(worktreeRoot, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = path.isAbsolute(gitCommonDirectory)
    ? gitCommonDirectory
    : path.resolve(worktreeRoot, gitCommonDirectory || ".git");
  const statePath = process.env.EATBID_WORKFLOW_STATE_PATH
    ? path.resolve(process.env.EATBID_WORKFLOW_STATE_PATH)
    : path.join(commonDirectory, "eatbid-agent-workflow", "state.json");
  return {
    branch: git(worktreeRoot, ["branch", "--show-current"]),
    isGitWorktree: Boolean(toplevel),
    statePath,
    worktreeRoot,
  };
}

// lease gate가 지키는 대상은 이 worktree 하나가 아니라 저장소 전체다. main checkout의 추적 파일,
// 형제 worktree, `.git` common dir, 그리고 lease state 파일 자신까지 모두 여기에 들어와야 "밖이면
// 허용" 규칙이 gate 자신을 열지 않는다. 하나라도 알아내지 못하면 빈 목록을 돌려 fail-closed한다.
export function repositoryGuardRoots(cwd) {
  const repository = repositoryContext(cwd);
  if (!repository.isGitWorktree) return [];
  const commonDirectory = git(repository.worktreeRoot, ["rev-parse", "--git-common-dir"]);
  if (!commonDirectory) return [];
  const absoluteCommonDirectory = path.isAbsolute(commonDirectory)
    ? commonDirectory
    : path.resolve(repository.worktreeRoot, commonDirectory);

  const worktreeList = git(repository.worktreeRoot, ["worktree", "list", "--porcelain"]);
  if (!worktreeList) return [];
  const linkedWorktrees = worktreeList
    .split(/\r?\n/)
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length).trim())
    .filter(Boolean);
  if (linkedWorktrees.length === 0) return [];

  return [
    repository.worktreeRoot,
    absoluteCommonDirectory,
    // common dir의 부모는 주 저장소 루트다. `.git`이 파일이 아니라 디렉터리인 main checkout에서
    // 이 값이 추적 파일 전체를 덮는다.
    path.dirname(absoluteCommonDirectory),
    ...linkedWorktrees,
    // state 경로는 환경변수로 옮길 수 있어 common dir 아래라고 가정하지 않는다.
    path.dirname(repository.statePath),
  ];
}

// `--worktree`는 세션 cwd 밖의 lease를 다루므로 존재하지 않거나 git worktree가 아닌 경로에서
// cwd 기준으로 조용히 fallback하면 엉뚱한 lease를 지운다. 명시적으로 실패한다.
export function targetRepositoryContext(cwd, worktreePath) {
  if (!worktreePath) return repositoryContext(cwd);
  const target = path.resolve(cwd, worktreePath);
  if (!existsSync(target)) throw new Error(`--worktree path does not exist: ${target}`);
  const repository = repositoryContext(target);
  if (!repository.isGitWorktree) throw new Error(`--worktree path is not a git worktree: ${target}`);
  return repository;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

// endpoint override는 실제 CLI 경로를 그대로 실행하는 통합 테스트의 loopback stub만을 위한 것이다.
// 임의 host를 받아주면 환경변수 하나로 Linear API key가 제3자 endpoint로 그대로 새어 나간다.
export function resolveLinearEndpoint(override, fallback, warn = (message) => process.stderr.write(message)) {
  if (!override) return fallback;
  let hostname = "";
  try {
    hostname = new URL(override).hostname;
  } catch {
    hostname = "";
  }
  if (LOOPBACK_HOSTS.has(hostname)) return override;
  warn(`EATBID_LINEAR_ENDPOINT는 loopback host만 허용합니다. 무시합니다: ${override}\n`);
  return fallback;
}

export function linearClient() {
  if (!process.env.LINEAR_API_KEY) {
    throw new Error("LINEAR_API_KEY is required for claim, sync and `release --review`");
  }
  return createLinearClient({
    apiKey: process.env.LINEAR_API_KEY,
    endpoint: resolveLinearEndpoint(process.env.EATBID_LINEAR_ENDPOINT, config.linearEndpoint),
    fetchImpl: (url, request) =>
      fetch(url, { ...request, signal: AbortSignal.timeout(config.requestTimeoutMs) }),
  });
}
