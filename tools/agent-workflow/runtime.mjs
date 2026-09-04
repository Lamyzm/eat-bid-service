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

export function linearClient() {
  if (!process.env.LINEAR_API_KEY) {
    throw new Error("LINEAR_API_KEY is required for claim, sync and `release --review`");
  }
  return createLinearClient({
    apiKey: process.env.LINEAR_API_KEY,
    // endpoint override는 실제 CLI 경로를 그대로 실행하는 통합 테스트와 self-hosted proxy를 위한
    // 것이다. 값이 없으면 언제나 config의 공식 endpoint를 쓴다.
    endpoint: process.env.EATBID_LINEAR_ENDPOINT || config.linearEndpoint,
    fetchImpl: (url, request) =>
      fetch(url, { ...request, signal: AbortSignal.timeout(config.requestTimeoutMs) }),
  });
}
