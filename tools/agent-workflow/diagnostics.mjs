/** @module 책임: worktree claim·session holder·lock의 현재 상태와 lock 복구 결과를 사람이 읽는 보고 값으로 모은다. */
import { holderIsLive } from "./session.mjs";
import {
  inspectStateLock,
  inspectWorkflowLock,
  recoverStateLock,
  recoverWorkflowLock,
} from "./state-lock.mjs";
import { getWorktreeClaim, getWorktreeHolder, loadState } from "./state.mjs";

// 보고에는 claim의 식별자·시각과 holder의 세션·생존 여부만 담고 prompt 흔적은 넣지 않는다. doctor는
// 막힌 이유를 확인하려고 아무 때나 실행되며 그 출력이 그대로 issue와 대화에 붙기 때문이다.
export async function doctorReport(repository, config, { now = () => new Date() } = {}) {
  const state = await loadState(repository.statePath);
  const claim = getWorktreeClaim(state, repository.worktreeRoot);
  const holder = getWorktreeHolder(state, repository.worktreeRoot);
  return {
    branch: repository.branch || null,
    claim: claim
      ? {
          branch: claim.branch ?? null,
          claimedAt: claim.claimedAt,
          issueIdentifier: claim.issueIdentifier,
          teamKey: claim.teamKey,
          verifiedAt: claim.verifiedAt,
        }
      : null,
    holder: holder
      ? {
          endedAt: holder.endedAt ?? null,
          lastSeenAt: holder.lastSeenAt,
          live: holderIsLive(holder, { now, staleAfterMs: (config.sessionStaleMinutes ?? 30) * 60 * 1000 }),
          pid: holder.pid ?? null,
          provider: holder.provider,
          sessionId: holder.sessionId,
        }
      : null,
    linearApiKeyConfigured: Boolean(process.env.LINEAR_API_KEY),
    linearMcpEndpoint: config.linearMcpEndpoint,
    outboxEvents: state.outbox.length,
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
