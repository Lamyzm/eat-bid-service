/** @module 책임: worktree lease·pending claim·lock의 현재 상태와 lock 복구 결과를 사람이 읽는 보고 값으로 모은다. */
import {
  inspectStateLock,
  inspectWorkflowLock,
  recoverStateLock,
  recoverWorkflowLock,
} from "./state-lock.mjs";
import { getPendingWorktreeClaim, getWorktreeLease, loadState } from "./state.mjs";

// 보고에는 lease와 claim의 식별자·시각만 담고 writer session이나 prompt 흔적은 넣지 않는다. doctor는
// 막힌 이유를 확인하려고 아무 때나 실행되며 그 출력이 그대로 issue와 대화에 붙기 때문이다.
export async function doctorReport(repository, config) {
  const state = await loadState(repository.statePath);
  const lease = getWorktreeLease(state, repository.worktreeRoot);
  const pendingClaim = getPendingWorktreeClaim(state, repository.worktreeRoot);
  return {
    branch: repository.branch || null,
    linearApiKeyConfigured: Boolean(process.env.LINEAR_API_KEY),
    linearMcpEndpoint: config.linearMcpEndpoint,
    lease: lease
      ? { expiresAt: lease.expiresAt, issueIdentifier: lease.issueIdentifier, teamKey: lease.teamKey }
      : null,
    outboxEvents: state.outbox.length,
    pendingClaim: pendingClaim
      ? { issueIdentifier: pendingClaim.issueIdentifier, requestedAt: pendingClaim.requestedAt }
      : null,
    stateLock: await inspectStateLock(repository.statePath),
    syncLock: await inspectWorkflowLock(repository.statePath, "sync"),
    statePath: repository.statePath,
    worktreeRoot: repository.worktreeRoot,
  };
}

export async function recoverLockReport(repository) {
  return {
    state: await recoverStateLock(repository.statePath),
    sync: await recoverWorkflowLock(repository.statePath, "sync"),
  };
}
