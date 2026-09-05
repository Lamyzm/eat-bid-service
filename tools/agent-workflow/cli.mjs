/** @module 책임: Linear issue 발행·claim·sync·release와 local worktree lease 명령을 조정한다. */
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

import { checkoutClaimBranch } from "./branch.mjs";
import { parseWorkflowArguments } from "./command-line.mjs";
import { doctorReport, recoverLockReport } from "./diagnostics.mjs";
import { runIssueCreate } from "./issue-command.mjs";
import { flushOutbox } from "./linear.mjs";
import { config, linearClient, repositoryContext, targetRepositoryContext } from "./runtime.mjs";
import {
  clearPendingWorktreeClaim,
  finalizePendingWorktreeClaim,
  getPendingWorktreeClaim,
  getWorktreeLease,
  loadState,
  removeOutboxEvents,
  reserveWorktreeClaim,
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

async function claim() {
  const parsed = parseWorkflowArguments(process.argv.slice(process.argv.indexOf("claim") + 1));
  const identifier = parsed.issueIdentifier;
  if (!identifier) {
    throw new Error("Usage: pnpm workflow:claim -- EAT-123 [--branch <name>] [--worktree <path>]");
  }
  if (parsed.review) throw new Error("--review belongs to release, not claim");

  // 브랜치를 먼저 맞춘 뒤 context를 다시 읽는다. lease에 기록할 branch는 claim이 끝난 시점의
  // 실제 HEAD여야 하며, 여기서 실패하면 Linear도 lease도 건드리지 않은 상태로 남는다.
  let repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  if (parsed.branchName) {
    // 이름 검사를 git보다 먼저 한다. 브랜치를 만들고 HEAD를 옮긴 뒤에 거부하면 세션은 claim도 못 한
    // 채 새 branch 불일치로 잠기고, 되돌릴 방법도 lease 안에서만 남는다.
    const requestedBranchIssue = extractIssueIdentifier(parsed.branchName);
    if (requestedBranchIssue && requestedBranchIssue !== identifier) {
      throw new Error(
        `Branch issue ${requestedBranchIssue} does not match requested claim ${identifier}`,
      );
    }
    checkoutClaimBranch(repository.worktreeRoot, parsed.branchName, repository.branch);
    repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  }
  const branchIssue = extractIssueIdentifier(repository.branch);
  if (branchIssue && branchIssue !== identifier) {
    throw new Error(`Branch issue ${branchIssue} does not match requested claim ${identifier}`);
  }

  const requestedAt = new Date();
  let pendingClaim;
  // Linear 변경과 local lease 저장은 하나의 원자 transaction이 될 수 없다. 먼저 복구 가능한
  // pending claim을 남겨 중복 writer를 막고, 중단 시 같은 identifier로 멱등 재개한다.
  await withStateTransaction(repository.statePath, async (state) => {
    const existing = getPendingWorktreeClaim(state, repository.worktreeRoot);
    if (existing) {
      if (existing.issueIdentifier !== identifier) {
        throw new Error(
          `Pending claim ${existing.issueIdentifier} must be completed before claiming ${identifier}`,
        );
      }
      pendingClaim = existing;
      return state;
    }

    pendingClaim = {
      attemptId: randomUUID(),
      branch: repository.branch || null,
      issueIdentifier: identifier,
      requestedAt: requestedAt.toISOString(),
      expiresAt: new Date(
        requestedAt.getTime() + config.leaseHours * 60 * 60 * 1000,
      ).toISOString(),
    };
    return reserveWorktreeClaim(state, repository.worktreeRoot, pendingClaim, {
      now: () => requestedAt,
    });
  });

  let verified;
  try {
    verified = await linearClient().claimIssue(identifier, config);
  } catch (error) {
    await withStateTransaction(repository.statePath, async (state) =>
      clearPendingWorktreeClaim(state, repository.worktreeRoot, pendingClaim.attemptId),
    );
    throw error;
  }
  const lease = {
    ...verified,
    branch: repository.branch || null,
    claimedAt: pendingClaim.requestedAt,
    expiresAt: pendingClaim.expiresAt,
    worktreeRoot: repository.worktreeRoot,
  };
  await withStateTransaction(repository.statePath, async (state) =>
    finalizePendingWorktreeClaim(
      state,
      repository.worktreeRoot,
      pendingClaim.attemptId,
      lease,
      { now: () => requestedAt },
    ),
  );
  process.stdout.write(`${JSON.stringify(lease, null, 2)}\n`);
}

// release는 Linear 상태를 기본으로 건드리지 않는다. 자동으로 In Review로 보내면 같은 worktree를
// 다시 claim할 때 상태 전환이 필요해지고, 그 전환이 막히면 이슈 전환 자체가 교착하기 때문이다.
// 원격 전이는 local lease를 지우기 전에 끝내 실패 시 같은 명령을 그대로 다시 실행할 수 있게 한다.
async function moveToReview(identifier) {
  if (!identifier) {
    throw new Error("--review needs an issue identifier or a worktree lease to name the issue");
  }
  await linearClient().moveIssueToState(identifier, config.reviewState);
  process.stdout.write(`Linear issue moved to ${config.reviewState}: ${identifier}\n`);
}

async function release() {
  const parsed = parseWorkflowArguments(process.argv.slice(process.argv.indexOf("release") + 1));
  if (parsed.branchName) throw new Error("--branch belongs to claim, not release");
  // issue 식별자 release는 worktree 경로가 이미 지워진 유령 lease를 푸는 경로다. 그래서 대상 경로가
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
      process.stdout.write(`Linear worktree lease released: ${parsed.issueIdentifier} @ ${worktreeRoot}\n`);
    }
    return;
  }

  const repository = targetRepositoryContext(process.cwd(), parsed.worktreePath);
  if (parsed.review) {
    const state = await loadState(repository.statePath);
    await moveToReview(getWorktreeLease(state, repository.worktreeRoot)?.issueIdentifier);
  }
  await withStateTransaction(repository.statePath, async (state) =>
    releaseWorktreeState(state, repository.worktreeRoot, { createId: randomUUID }),
  );
  process.stdout.write(`Linear worktree lease released: ${repository.worktreeRoot}\n`);
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

// issue 발행은 lease나 worktree와 무관하다. 새 작업을 시작하려는 세션이 아직 claim할 issue를 갖고
// 있지 않은 상태에서 실행하는 명령이므로 저장소 context를 요구하지 않는다.
async function issue() {
  const [subcommand, ...rest] = process.argv.slice(process.argv.indexOf("issue") + 1);
  if (subcommand !== "create") {
    throw new Error(`Usage: pnpm workflow:issue create --title <t> (got ${subcommand ?? "nothing"})`);
  }
  await runIssueCreate({ args: rest, client: linearClient(), config });
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
  if (command === "sync") return sync();
  if (command === "recover-lock") return recoverLock();
  if (command === "worktree") return worktree();
  throw new Error(`Unknown workflow command: ${command ?? "missing"}`);
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow command failed: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
