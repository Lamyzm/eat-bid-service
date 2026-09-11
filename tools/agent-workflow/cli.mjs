/** @module 책임: Linear issue 발행·claim·sync·release, pull request 열기와 local worktree claim·session 잠금 명령을 조정한다. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { checkoutClaimBranch } from "./branch.mjs";
import { parseWorkflowArguments } from "./command-line.mjs";
import { doctorReport, recoverLockReport } from "./diagnostics.mjs";
import { runIssueCreate, runIssueList } from "./issue-command.mjs";
import { flushOutbox } from "./linear.mjs";
import {
  config,
  currentSessionIdentity,
  linearClient,
  repositoryContext,
  targetRepositoryContext,
} from "./runtime.mjs";
import { runPullRequest } from "./pull-request.mjs";
import { describeHolder, endWorktreeHolder, holderIsLive } from "./session.mjs";
import {
  findWorktreesByIssue,
  getWorktreeClaim,
  getWorktreeHolder,
  loadState,
  removeOutboxEvents,
  setWorktreeClaim,
} from "./state.mjs";
import {
  gitWorktreePrune,
  gitWorktreeRemove,
  pruneMissingWorktreeState,
  pruneWorktreeState,
  releaseIssueState,
  releaseWorktreeState,
  resolveWorktreeTarget,
} from "./worktree.mjs";
import { withStateTransaction, withWorkflowLock } from "./state-lock.mjs";
import { extractIssueIdentifier } from "./workflow.mjs";

function commandContext(command) {
  const parsed = parseWorkflowArguments(process.argv.slice(process.argv.indexOf(command) + 1));
  return {
    issueIdentifier: parsed.issueIdentifier,
    repository: targetRepositoryContext(process.cwd(), parsed.worktreePath),
  };
}

async function doctor() {
  const { repository } = commandContext("doctor");
  process.stdout.write(`${JSON.stringify(await doctorReport(repository, config), null, 2)}\n`);
}

async function recoverLock() {
  const { repository } = commandContext("recover-lock");
  process.stdout.write(`${JSON.stringify(await recoverLockReport(repository), null, 2)}\n`);
}

function staleAfterMs() {
  return (config.sessionStaleMinutes ?? 30) * 60 * 1000;
}

// 같은 issue를 다른 worktree의 살아 있는 세션이 쓰고 있으면 writer가 둘이 된다(AGENTS 20). 그 세션이
// 이 세션이거나 죽었으면 그쪽 claim은 옮겨도 되는 기록일 뿐이다.
function conflictingLiveClaim(state, identifier, worktreeRoot, identity) {
  const targetKey = path.resolve(worktreeRoot).replaceAll("\\", "/").toLowerCase();
  for (const match of findWorktreesByIssue(state, identifier)) {
    if (match.worktreeRoot.toLowerCase() === targetKey) continue;
    if (!holderIsLive(match.holder, { now: () => new Date(), staleAfterMs: staleAfterMs() })) continue;
    if (identity.sessionId && match.holder.sessionId === identity.sessionId) continue;
    return match;
  }
  return null;
}

async function claim() {
  const parsed = parseWorkflowArguments(process.argv.slice(process.argv.indexOf("claim") + 1));
  const identifier = parsed.issueIdentifier;
  if (!identifier) {
    throw new Error("Usage: pnpm workflow:claim -- EAT-123 [--branch <name>] [--worktree <path>]");
  }
  if (parsed.review) throw new Error("--review belongs to release, not claim");

  let repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  if (parsed.branchName) {
    const requestedBranchIssue = extractIssueIdentifier(parsed.branchName);
    if (requestedBranchIssue && requestedBranchIssue !== identifier) {
      throw new Error(
        `Branch issue ${requestedBranchIssue} does not match requested claim ${identifier}`,
      );
    }
  } else {
    const branchIssue = extractIssueIdentifier(repository.branch);
    if (branchIssue && branchIssue !== identifier) {
      throw new Error(`Branch issue ${branchIssue} does not match requested claim ${identifier}`);
    }
  }

  const identity = currentSessionIdentity();
  const before = await loadState(repository.statePath);
  const conflict = conflictingLiveClaim(before, identifier, repository.worktreeRoot, identity);
  if (conflict) {
    throw new Error(
      `${identifier} is being written in ${conflict.worktreeRoot} by ${describeHolder(conflict.holder)}; work there or wait for that session to end`,
    );
  }

  // Linear 검증이 먼저다. 여기서 거부되면 branch도 local 기록도 그대로다. 검증 뒤의 branch 전환이 dirty
  // worktree로 실패하면 Linear는 In Progress로 남지만 같은 명령을 다시 실행하면 그대로 이어진다.
  const verified = await linearClient().claimIssue(identifier, config);
  if (parsed.branchName) {
    checkoutClaimBranch(repository.worktreeRoot, parsed.branchName, repository.branch);
    repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  }

  const claimedAt = new Date().toISOString();
  const record = {
    ...verified,
    branch: repository.branch || null,
    claimedAt,
    verifiedAt: claimedAt,
  };
  let replaced = null;
  await withStateTransaction(repository.statePath, async (state) => {
    const existing = getWorktreeClaim(state, repository.worktreeRoot);
    if (existing && existing.issueIdentifier !== identifier) replaced = existing.issueIdentifier;
    let nextState = state;
    // 다른 worktree에 남은 같은 issue의 죽은 claim은 이 claim으로 옮겨진 것이다. 남겨 두면 doctor와 release가
    // 두 곳을 가리킨다.
    for (const match of findWorktreesByIssue(state, identifier)) {
      if (match.worktreeRoot.toLowerCase() === path.resolve(repository.worktreeRoot).replaceAll("\\", "/").toLowerCase()) continue;
      nextState = releaseWorktreeState(nextState, match.worktreeRoot, { createId: randomUUID });
    }
    return setWorktreeClaim(nextState, repository.worktreeRoot, record);
  });
  if (replaced) {
    process.stderr.write(`이 worktree의 이전 claim ${replaced}를 ${identifier}로 바꿨습니다. ${replaced}가 끝났다면 Linear 상태를 직접 옮기세요.\n`);
  }
  process.stdout.write(`${JSON.stringify({ ...record, worktreeRoot: repository.worktreeRoot }, null, 2)}\n`);
}

// release는 Linear 상태를 기본으로 건드리지 않는다. 자동으로 In Review로 보내면 같은 worktree를
// 다시 claim할 때 상태 전환이 필요해지고, 그 전환이 막히면 이슈 전환 자체가 교착하기 때문이다.
// 원격 전이는 local claim을 지우기 전에 끝내 실패 시 같은 명령을 그대로 다시 실행할 수 있게 한다.
async function moveToReview(identifier) {
  if (!identifier) {
    throw new Error("--review needs an issue identifier or a worktree claim to name the issue");
  }
  await linearClient().moveIssueToState(identifier, config.reviewState);
  process.stdout.write(`Linear issue moved to ${config.reviewState}: ${identifier}\n`);
}

async function release() {
  const parsed = parseWorkflowArguments(process.argv.slice(process.argv.indexOf("release") + 1));
  if (parsed.branchName) throw new Error("--branch belongs to claim, not release");
  // issue 식별자 release는 worktree 경로가 이미 지워진 유령 claim을 푸는 경로다. 그래서 대상 경로가
  // 존재하는지 검사하지 않으며, `--worktree`와 함께 오면 어느 쪽을 믿을지 모호해 거부한다.
  if (parsed.issueIdentifier) {
    if (parsed.worktreePath) {
      throw new Error("Choose either an issue identifier or --worktree <path> for release");
    }
    if (parsed.review) await moveToReview(parsed.issueIdentifier);
    const { statePath } = repositoryContext(process.cwd());
    let released = [];
    await withStateTransaction(statePath, async (state) => {
      const result = releaseIssueState(state, parsed.issueIdentifier, { createId: randomUUID });
      released = result.released;
      return result.state;
    });
    for (const worktreeRoot of released) {
      process.stdout.write(`Linear worktree claim released: ${parsed.issueIdentifier} @ ${worktreeRoot}\n`);
    }
    return;
  }

  const repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  if (parsed.review) {
    const state = await loadState(repository.statePath);
    await moveToReview(getWorktreeClaim(state, repository.worktreeRoot)?.issueIdentifier);
  }
  await withStateTransaction(repository.statePath, async (state) =>
    releaseWorktreeState(state, repository.worktreeRoot, { createId: randomUUID }),
  );
  process.stdout.write(`Linear worktree claim released: ${repository.worktreeRoot}\n`);
}

// 세션 잠금은 hook이 자동으로 잡고 넘겨받는다. 이 명령은 holder의 pid도 heartbeat도 죽음을 말해 주지
// 않는데 사람이 그 세션이 끝났다고 아는 경우를 위한 것이다. 끝났다고 표시만 하며, 다음에 쓰는 세션이 잡는다.
async function session() {
  const [subcommand, ...rest] = process.argv
    .slice(process.argv.indexOf("session") + 1)
    .filter((argument) => argument !== "--");
  const parsed = parseWorkflowArguments(rest);
  const repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);

  if (subcommand === "take") {
    let previous = null;
    await withStateTransaction(repository.statePath, async (state) => {
      previous = getWorktreeHolder(state, repository.worktreeRoot);
      return endWorktreeHolder(state, repository.worktreeRoot);
    });
    process.stdout.write(
      previous?.sessionId && !previous.endedAt
        ? `Worktree session lock ended: ${describeHolder(previous)} @ ${repository.worktreeRoot}. The next writing session takes it.\n`
        : `No live session lock to take @ ${repository.worktreeRoot}.\n`,
    );
    return;
  }

  throw new Error(`Usage: pnpm workflow:session take [--worktree <path>] (got ${subcommand ?? "nothing"})`);
}

async function worktree() {
  const [subcommand, ...rest] = process.argv
    .slice(process.argv.indexOf("worktree") + 1)
    .filter((argument) => argument !== "--");
  const repository = repositoryContext(process.cwd());

  if (subcommand === "prune") {
    if (rest.length > 0) throw new Error("Usage: pnpm workflow:worktree prune");
    gitWorktreePrune(repository.worktreeRoot);
    let pruned = [];
    await withStateTransaction(repository.statePath, async (state) => {
      const result = pruneMissingWorktreeState(state, { createId: randomUUID });
      pruned = result.pruned;
      return result.state;
    });
    process.stdout.write(`${JSON.stringify({ pruned }, null, 2)}\n`);
    return;
  }

  if (subcommand === "remove") {
    if (rest.length !== 1) throw new Error("Usage: pnpm workflow:worktree remove <path>");
    const target = resolveWorktreeTarget(process.cwd(), rest[0]);
    const targetRoot = existsSync(target) ? repositoryContext(target).worktreeRoot : target;
    if (path.resolve(targetRoot) === path.resolve(repository.worktreeRoot)) {
      throw new Error("Cannot remove the worktree the session is running in; run from another worktree");
    }
    const gitResult = gitWorktreeRemove(repository.worktreeRoot, targetRoot);
    await withStateTransaction(repository.statePath, async (state) =>
      pruneWorktreeState(state, targetRoot, { createId: randomUUID }),
    );
    process.stdout.write(`${JSON.stringify({ git: gitResult, worktreeRoot: targetRoot }, null, 2)}\n`);
    return;
  }

  throw new Error(`Usage: pnpm workflow:worktree remove <path> | prune (got ${subcommand ?? "nothing"})`);
}

// issue 발행은 claim이나 worktree와 무관하다. 새 작업을 시작하려는 세션이 아직 claim할 issue를 갖고
// 있지 않은 상태에서 실행하는 명령이므로 저장소 context를 요구하지 않는다.
async function issue() {
  // `main`이 `process.argv[2]`로 command를 고르므로 인자는 언제나 그 다음부터다. `indexOf("issue")`로
  // 찾으면 node 실행 경로나 저장소 경로에 같은 낱말이 있을 때 엉뚱한 자리에서 자른다.
  const [subcommand, ...rest] = process.argv.slice(3);
  if (subcommand === "create") {
    // 본문 파일을 읽는 범위는 작업 공간과 임시 디렉터리로 한정한다. 저장소 루트를 알아내지 못하면
    // 임시 디렉터리만 남으므로 임의 경로가 조용히 통과하지 않는다.
    const repository = repositoryContext(process.cwd());
    await runIssueCreate({
      allowedDescriptionRoots: [
        ...(repository.isGitWorktree ? [repository.worktreeRoot, path.dirname(repository.statePath)] : []),
        tmpdir(),
      ],
      args: rest,
      client: linearClient(),
      config,
    });
    return;
  }
  if (subcommand === "list") {
    await runIssueList({ args: rest, client: linearClient(), config });
    return;
  }
  throw new Error(
    `Usage: pnpm workflow:issue create --title <t> | pnpm workflow:issues [--state <name>] (got ${subcommand ?? "nothing"})`,
  );
}

async function sync() {
  const { repository } = commandContext("sync");
  let result = null;
  // 원격 I/O는 별도 sync lock으로만 직렬화한다. 짧은 state transaction은 snapshot/ack 때만 잡아
  // mutation 후 PostToolUse와 Stop이 네트워크 대기 때문에 기록을 놓치지 않게 한다.
  await withWorkflowLock(repository.statePath, "sync", async () => {
    let snapshot;
    await withStateTransaction(repository.statePath, async (state) => {
      snapshot = state;
      return state;
    });
    if (snapshot.outbox.length === 0) return;

    result = await flushOutbox(snapshot.outbox, linearClient());
    const acknowledgedIds = snapshot.outbox.slice(0, result.sent).map((event) => event.id);
    if (acknowledgedIds.length > 0) {
      await withStateTransaction(repository.statePath, async (state) =>
        removeOutboxEvents(state, acknowledgedIds),
      );
    }
  });
  if (!result) {
    process.stdout.write("Linear outbox is empty.\n");
    return;
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        error: result.error?.message ?? null,
        remaining: result.remaining.length,
        sent: result.sent,
      },
      null,
      2,
    )}\n`,
  );
  if (result.error) process.exitCode = 1;
}

async function main() {
  const command = process.argv[2];
  if (command === "doctor") return doctor();
  if (command === "claim") return claim();
  if (command === "issue") return issue();
  if (command === "release") return release();
  if (command === "session") return session();
  if (command === "sync") return sync();
  if (command === "recover-lock") return recoverLock();
  if (command === "worktree") return worktree();
  if (command === "pr") return runPullRequest();
  throw new Error(`Unknown workflow command: ${command ?? "missing"}`);
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow command failed: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
