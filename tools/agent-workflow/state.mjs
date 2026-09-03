/** @module 책임: worktree lease·pending claim·session 기록·outbox를 담는 workflow state의 순수 전이와 원자적 저장을 소유한다. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export function createEmptyState() {
  return { version: 1, worktrees: {}, outbox: [] };
}

export class StateCorruptionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "StateCorruptionError";
  }
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createEmptyState();
  return {
    version: 1,
    worktrees:
      value.worktrees && typeof value.worktrees === "object" && !Array.isArray(value.worktrees)
        ? value.worktrees
        : {},
    outbox: Array.isArray(value.outbox) ? value.outbox : [],
  };
}

function worktreeKey(worktreeRoot) {
  const normalized = path.resolve(String(worktreeRoot)).replaceAll("\\", "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export async function loadState(statePath, { now = () => new Date() } = {}) {
  try {
    return normalizeState(JSON.parse(await readFile(statePath, "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return createEmptyState();
    if (!(error instanceof SyntaxError)) throw error;

    const timestamp = now().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    const quarantinePath = `${statePath}.corrupt-${timestamp}`;
    await rename(statePath, quarantinePath);
    throw new StateCorruptionError(`Workflow state was quarantined at ${quarantinePath}`, {
      cause: error,
    });
  }
}

export async function saveState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(normalizeState(state), null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(temporaryPath, statePath);
}

export function getSessionState(state, worktreeRoot, sessionId) {
  return state.worktrees?.[worktreeKey(worktreeRoot)]?.sessions?.[String(sessionId)] ?? {};
}

export function getWorktreeSessions(state, worktreeRoot) {
  return state.worktrees?.[worktreeKey(worktreeRoot)]?.sessions ?? {};
}

export function getWorktreeLease(state, worktreeRoot) {
  return state.worktrees?.[worktreeKey(worktreeRoot)]?.lease ?? null;
}

export function getPendingWorktreeClaim(state, worktreeRoot) {
  return state.worktrees?.[worktreeKey(worktreeRoot)]?.pendingClaim ?? null;
}

// state key는 정규화된 경로라 그 자체가 worktree root다. 삭제된 worktree처럼 세션 cwd로 root를
// 계산할 수 없을 때 issue 식별자만으로 lease와 pending claim을 찾는 유일한 경로다.
export function findWorktreesByIssue(state, issueIdentifier) {
  const normalized = String(issueIdentifier ?? "").toUpperCase();
  return Object.entries(state.worktrees ?? {})
    .filter(
      ([, worktree]) =>
        worktree?.lease?.issueIdentifier === normalized ||
        worktree?.pendingClaim?.issueIdentifier === normalized,
    )
    .map(([worktreeRoot, worktree]) => ({
      lease: worktree.lease ?? null,
      pendingClaim: worktree.pendingClaim ?? null,
      worktreeRoot,
    }));
}

export function listWorktreeLeases(state) {
  return Object.entries(state.worktrees ?? {})
    .filter(([, worktree]) => worktree?.lease?.issueIdentifier)
    .map(([worktreeRoot, worktree]) => ({ lease: worktree.lease, worktreeRoot }));
}

export function listWorktreeRoots(state) {
  return Object.keys(state.worktrees ?? {});
}

export function removeWorktreeEntry(state, worktreeRoot) {
  const key = worktreeKey(worktreeRoot);
  if (!state.worktrees?.[key]) return state;
  const { [key]: _removed, ...worktrees } = state.worktrees;
  return { ...state, worktrees };
}

export function setWorktreeLease(state, worktreeRoot, lease) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key] ?? { sessions: {} };
  return {
    ...state,
    worktrees: {
      ...state.worktrees,
      [key]: { ...worktree, lease: { ...lease } },
    },
  };
}

export function claimWorktreeLease(state, worktreeRoot, lease, { now = () => new Date() } = {}) {
  const key = worktreeKey(worktreeRoot);
  const nowMilliseconds = now().getTime();
  const current = state.worktrees?.[key]?.lease;
  const currentIsActive = current?.expiresAt && Date.parse(current.expiresAt) > nowMilliseconds;

  if (currentIsActive && current.issueIdentifier !== lease.issueIdentifier) {
    throw new Error(
      `Worktree is leased to ${current.issueIdentifier}; release it before claiming ${lease.issueIdentifier}`,
    );
  }

  for (const [otherKey, worktree] of Object.entries(state.worktrees ?? {})) {
    const otherLease = worktree?.lease;
    if (
      otherKey !== key &&
      otherLease?.issueIdentifier === lease.issueIdentifier &&
      otherLease?.expiresAt &&
      Date.parse(otherLease.expiresAt) > nowMilliseconds
    ) {
      throw new Error(
        `${lease.issueIdentifier} is already leased by another worktree until ${otherLease.expiresAt}`,
      );
    }
  }

  return setWorktreeLease(state, worktreeRoot, {
    ...lease,
    ...(currentIsActive && current.issueIdentifier === lease.issueIdentifier && current.writer
      ? { writer: current.writer }
      : {}),
  });
}

export function clearWorktreeLease(state, worktreeRoot) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key];
  if (!worktree) return state;
  const { lease: _lease, ...withoutLease } = worktree;
  return {
    ...state,
    worktrees: { ...state.worktrees, [key]: withoutLease },
  };
}

// release가 lease와 함께 session의 issue 기록을 지우지 않으면 같은 session이 다음 issue를 claim해도
// 이전 prompt의 identifier와 불일치로 차단돼 사용자가 새 prompt를 보내야만 풀린다.
export function clearWorktreeSessionIssues(state, worktreeRoot) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key];
  if (!worktree?.sessions) return state;
  const sessions = Object.fromEntries(
    Object.entries(worktree.sessions).map(([sessionId, session]) => {
      const { activeIssue: _activeIssue, requestedIssue: _requestedIssue, ...rest } = session ?? {};
      return [sessionId, rest];
    }),
  );
  return {
    ...state,
    worktrees: { ...state.worktrees, [key]: { ...worktree, sessions } },
  };
}

export function reserveWorktreeClaim(state, worktreeRoot, pendingClaim, { now = () => new Date() } = {}) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key] ?? { sessions: {} };
  const current = worktree.pendingClaim;
  if (current) {
    if (
      current.attemptId === pendingClaim.attemptId &&
      current.issueIdentifier === pendingClaim.issueIdentifier
    ) {
      return state;
    }
    throw new Error(
      `A pending claim for ${current.issueIdentifier ?? "unknown"} must be completed or recovered first`,
    );
  }

  for (const [otherKey, otherWorktree] of Object.entries(state.worktrees ?? {})) {
    if (
      otherKey !== key &&
      otherWorktree?.pendingClaim?.issueIdentifier === pendingClaim.issueIdentifier
    ) {
      throw new Error(
        `A pending claim for ${pendingClaim.issueIdentifier} already exists in another worktree`,
      );
    }
  }

  // 기존 lease 및 다른 worktree의 동일 issue lease 충돌을 원격 변경 전에 검증한다.
  claimWorktreeLease(
    state,
    worktreeRoot,
    {
      issueIdentifier: pendingClaim.issueIdentifier,
      expiresAt: pendingClaim.expiresAt,
    },
    { now },
  );

  return {
    ...state,
    worktrees: {
      ...state.worktrees,
      [key]: { ...worktree, pendingClaim: { ...pendingClaim } },
    },
  };
}

export function clearPendingWorktreeClaim(state, worktreeRoot, attemptId) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key];
  if (!worktree?.pendingClaim) return state;
  if (attemptId && worktree.pendingClaim.attemptId !== attemptId) return state;
  const { pendingClaim: _pendingClaim, ...withoutPendingClaim } = worktree;
  return {
    ...state,
    worktrees: { ...state.worktrees, [key]: withoutPendingClaim },
  };
}

export function finalizePendingWorktreeClaim(
  state,
  worktreeRoot,
  attemptId,
  lease,
  { now = () => new Date() } = {},
) {
  const pending = getPendingWorktreeClaim(state, worktreeRoot);
  if (!pending || pending.attemptId !== attemptId) {
    throw new Error(`Pending claim attempt ${attemptId} was not found`);
  }
  if (pending.issueIdentifier !== lease.issueIdentifier) {
    throw new Error(
      `Pending claim ${pending.issueIdentifier} does not match verified lease ${lease.issueIdentifier}`,
    );
  }
  const claimed = claimWorktreeLease(state, worktreeRoot, lease, { now });
  return clearPendingWorktreeClaim(claimed, worktreeRoot, attemptId);
}

export function updateSessionState(state, worktreeRoot, sessionId, patch) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key] ?? { sessions: {} };
  const sessions = worktree.sessions ?? {};
  const currentSession = sessions[String(sessionId)] ?? {};

  return {
    ...state,
    worktrees: {
      ...state.worktrees,
      [key]: {
        ...worktree,
        sessions: {
          ...sessions,
          [String(sessionId)]: { ...currentSession, ...patch },
        },
      },
    },
  };
}

export function enqueueEvent(state, event) {
  return { ...state, outbox: [...(state.outbox ?? []), { ...event }] };
}

export function replaceOutbox(state, outbox) {
  return { ...state, outbox: [...outbox] };
}

export function removeOutboxEvents(state, eventIds) {
  const acknowledged = new Set(eventIds);
  return { ...state, outbox: state.outbox.filter((event) => !acknowledged.has(event.id)) };
}
