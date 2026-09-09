/** @module 책임: 세션 cwd 또는 `--worktree` 대상에서 git worktree root·common dir·공유 state 경로·branch를 결정하고 Linear client를 만든다. */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
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
 * git을 실행하지 않고 파일만 읽어 worktree root와 common dir을 찾는다. hook은 도구 호출마다 실행되므로
 * child process 셋을 띄우는 비용을 매번 낼 수 없다. `.git`이 디렉터리면 그것이 common dir이고, linked
 * worktree의 `.git` 파일은 `gitdir:`로 가리키는 디렉터리의 `commondir` 파일이 common dir을 말한다.
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

export function statePathFor(commonDirectory) {
  if (process.env.EATBID_WORKFLOW_STATE_PATH) return path.resolve(process.env.EATBID_WORKFLOW_STATE_PATH);
  return path.join(commonDirectory, "eatbid-agent-workflow", "state.json");
}

/** hook이 쓰는 가벼운 context다. branch를 읽지 않으므로 git을 실행하지 않는다. */
export function hookRepositoryContext(cwd) {
  const located = locateRepository(cwd);
  if (!located.isGitWorktree) return null;
  return {
    statePath: statePathFor(located.commonDirectory),
    worktreeRoot: located.worktreeRoot,
  };
}

export function repositoryContext(cwd) {
  const located = locateRepository(cwd);
  const worktreeRoot = located.worktreeRoot ?? path.resolve(cwd);
  const commonDirectory = located.commonDirectory ?? path.join(worktreeRoot, ".git");
  return {
    branch: located.isGitWorktree ? git(worktreeRoot, ["branch", "--show-current"]) : "",
    isGitWorktree: located.isGitWorktree,
    statePath: statePathFor(commonDirectory),
    worktreeRoot,
  };
}

// `--worktree`는 세션 cwd 밖의 claim을 다루므로 존재하지 않거나 git worktree가 아닌 경로에서
// cwd 기준으로 조용히 fallback하면 엉뚱한 claim을 지운다. 명시적으로 실패한다.
export function targetRepositoryContext(cwd, worktreePath) {
  if (!worktreePath) return repositoryContext(cwd);
  const target = path.resolve(cwd, worktreePath);
  if (!existsSync(target)) throw new Error(`--worktree path does not exist: ${target}`);
  const repository = repositoryContext(target);
  if (!repository.isGitWorktree) throw new Error(`--worktree path is not a git worktree: ${target}`);
  return repository;
}

// claim 명령은 Bash 도구의 child로 실행되므로 hook처럼 session id를 stdin으로 받지 못한다. Claude Code는
// child 환경에 세션 id와 자기 pid를 넣어 주며, 없는 provider에서는 "이 세션"을 알 수 없다고 본다.
export function currentSessionIdentity(environment = process.env) {
  const sessionId = environment.CLAUDE_CODE_SESSION_ID;
  const pid = Number.parseInt(environment.CLAUDE_PID ?? "", 10);
  return {
    pid: Number.isInteger(pid) && pid > 0 ? pid : null,
    provider: sessionId ? "claude" : null,
    sessionId: sessionId || null,
  };
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
