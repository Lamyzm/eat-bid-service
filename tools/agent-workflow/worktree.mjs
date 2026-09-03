/** @module 책임: worktree 단위 lease 해제와 사라진 worktree 정리를 git worktree 명령과 같은 단위로 묶어 유령 lease가 남지 않게 한다. */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { finalizeSessionWorklog } from "./hook-runtime.mjs";
import {
  clearPendingWorktreeClaim,
  clearWorktreeLease,
  clearWorktreeSessionIssues,
  findWorktreesByIssue,
  getWorktreeLease,
  getWorktreeSessions,
  listWorktreeRoots,
  removeWorktreeEntry,
} from "./state.mjs";

// release는 아직 Stop되지 않은 session의 변경 경로를 원래 issue의 worklog로 먼저 확정한다. 그렇지
// 않으면 lease가 사라진 뒤 Stop이 와도 issue를 알 수 없어 기록이 버려진다.
export function releaseWorktreeState(state, worktreeRoot, { createId, now = () => new Date() }) {
  const lease = getWorktreeLease(state, worktreeRoot);
  let nextState = state;
  for (const sessionId of Object.keys(getWorktreeSessions(state, worktreeRoot))) {
    nextState = finalizeSessionWorklog({
      createId,
      lease,
      now,
      provider: lease?.writer?.provider ?? "release",
      sessionId,
      state: nextState,
      worktreeRoot,
    });
  }
  nextState = clearWorktreeSessionIssues(nextState, worktreeRoot);
  nextState = clearPendingWorktreeClaim(nextState, worktreeRoot);
  return clearWorktreeLease(nextState, worktreeRoot);
}

// worktree 디렉터리가 사라지면 session도 다시 살아나지 않으므로 worklog만 남기고 항목을 통째로 지운다.
export function pruneWorktreeState(state, worktreeRoot, options) {
  return removeWorktreeEntry(releaseWorktreeState(state, worktreeRoot, options), worktreeRoot);
}

export function releaseIssueState(state, issueIdentifier, options) {
  const matches = findWorktreesByIssue(state, issueIdentifier);
  if (matches.length === 0) {
    throw new Error(`No worktree lease or pending claim exists for ${issueIdentifier}`);
  }
  let nextState = state;
  for (const match of matches) {
    nextState = releaseWorktreeState(nextState, match.worktreeRoot, options);
  }
  return { released: matches.map((match) => match.worktreeRoot), state: nextState };
}

export function pruneMissingWorktreeState(state, options, { pathExists = existsSync } = {}) {
  let nextState = state;
  const pruned = [];
  for (const worktreeRoot of listWorktreeRoots(state)) {
    if (pathExists(worktreeRoot)) continue;
    nextState = pruneWorktreeState(nextState, worktreeRoot, options);
    pruned.push(worktreeRoot);
  }
  return { pruned, state: nextState };
}

function git(repositoryRoot, args) {
  try {
    return execFileSync("git", ["-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim();
    throw new Error(`git ${args.join(" ")} failed: ${detail}`);
  }
}

export function gitWorktreePrune(repositoryRoot) {
  git(repositoryRoot, ["worktree", "prune"]);
}

// git remove가 dirty worktree 등으로 거부되면 lease를 지우지 않는다. lease만 사라진 살아 있는
// worktree는 그 안의 세션을 이유 없이 막는 새 장애가 되기 때문이다.
export function gitWorktreeRemove(repositoryRoot, worktreePath) {
  if (existsSync(worktreePath)) {
    git(repositoryRoot, ["worktree", "remove", worktreePath]);
    return "removed";
  }
  gitWorktreePrune(repositoryRoot);
  return "pruned";
}

export function resolveWorktreeTarget(cwd, worktreePath) {
  if (!worktreePath) throw new Error("Usage: pnpm workflow:worktree remove <path>");
  return path.resolve(cwd, worktreePath);
}
