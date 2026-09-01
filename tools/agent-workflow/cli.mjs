/** @module 책임: Linear issue claim·sync·release와 local worktree lease 명령을 조정한다. */
import { randomUUID } from "node:crypto";

import { finalizeSessionWorklog } from "./hook-runtime.mjs";
import { flushOutbox } from "./linear.mjs";
import { config, linearClient, repositoryContext } from "./runtime.mjs";
import {
  clearPendingWorktreeClaim,
  clearWorktreeLease,
  finalizePendingWorktreeClaim,
  getPendingWorktreeClaim,
  getWorktreeLease,
  getWorktreeSessions,
  loadState,
  removeOutboxEvents,
  reserveWorktreeClaim,
} from "./state.mjs";
import {
  inspectStateLock,
  inspectWorkflowLock,
  recoverStateLock,
  recoverWorkflowLock,
  withStateTransaction,
  withWorkflowLock,
} from "./state-lock.mjs";
import { extractIssueIdentifier } from "./workflow.mjs";

async function doctor() {
  const repository = repositoryContext(process.cwd());
  const state = await loadState(repository.statePath);
  const lease = getWorktreeLease(state, repository.worktreeRoot);
  const pendingClaim = getPendingWorktreeClaim(state, repository.worktreeRoot);
  const stateLock = await inspectStateLock(repository.statePath);
  const syncLock = await inspectWorkflowLock(repository.statePath, "sync");
  process.stdout.write(
    `${JSON.stringify(
      {
        branch: repository.branch || null,
        linearApiKeyConfigured: Boolean(process.env.LINEAR_API_KEY),
        linearMcpEndpoint: config.linearMcpEndpoint,
        lease: lease
          ? {
              expiresAt: lease.expiresAt,
              issueIdentifier: lease.issueIdentifier,
              teamKey: lease.teamKey,
            }
          : null,
        outboxEvents: state.outbox.length,
        pendingClaim: pendingClaim
          ? {
              issueIdentifier: pendingClaim.issueIdentifier,
              requestedAt: pendingClaim.requestedAt,
            }
          : null,
        stateLock,
        syncLock,
        statePath: repository.statePath,
        worktreeRoot: repository.worktreeRoot,
      },
      null,
      2,
    )}\n`,
  );
}

async function recoverLock() {
  const repository = repositoryContext(process.cwd());
  const result = {
    state: await recoverStateLock(repository.statePath),
    sync: await recoverWorkflowLock(repository.statePath, "sync"),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function claim() {
  const identifier = extractIssueIdentifier(process.argv.slice(process.argv.indexOf("claim") + 1));
  if (!identifier) throw new Error("Usage: pnpm workflow:claim -- EAT-123");
  const repository = repositoryContext(process.cwd());
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

async function release() {
  const repository = repositoryContext(process.cwd());
  await withStateTransaction(repository.statePath, async (state) => {
    const lease = getWorktreeLease(state, repository.worktreeRoot);
    let nextState = state;
    for (const sessionId of Object.keys(getWorktreeSessions(state, repository.worktreeRoot))) {
      nextState = finalizeSessionWorklog({
        createId: randomUUID,
        lease,
        provider: lease?.writer?.provider ?? "release",
        sessionId,
        state: nextState,
        worktreeRoot: repository.worktreeRoot,
      });
    }
    return clearWorktreeLease(nextState, repository.worktreeRoot);
  });
  process.stdout.write("Linear worktree lease released.\n");
}

async function sync() {
  const repository = repositoryContext(process.cwd());
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

    result = await flushOutbox(snapshot.outbox, linearClient(), config);
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
  if (command === "release") return release();
  if (command === "sync") return sync();
  if (command === "recover-lock") return recoverLock();
  throw new Error(`Unknown workflow command: ${command ?? "missing"}`);
}

main().catch((error) => {
  process.stderr.write(`eatbid workflow command failed: ${error?.message ?? String(error)}\n`);
  process.exitCode = 1;
});
