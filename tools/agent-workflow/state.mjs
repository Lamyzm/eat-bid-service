/** @module 책임: worktree claim·session holder·session 변경 기록·outbox를 담는 workflow state의 순수 전이와 원자적 저장을 소유한다. */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const STATE_VERSION = 2;

export function createEmptyState() {
  return { version: STATE_VERSION, worktrees: {}, outbox: [] };
}

export class StateCorruptionError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "StateCorruptionError";
  }
}

const CLAIM_FIELDS = [
  "assigneeId",
  "assigneeName",
  "branch",
  "claimedAt",
  "issueId",
  "issueIdentifier",
  "teamKey",
  "verifiedAt",
];

function pickClaim(value) {
  if (!value || typeof value !== "object" || !value.issueIdentifier) return null;
  const claim = {};
  for (const field of CLAIM_FIELDS) {
    if (value[field] !== undefined && value[field] !== null) claim[field] = value[field];
  }
  if (!claim.verifiedAt && claim.claimedAt) claim.verifiedAt = claim.claimedAt;
  return claim;
}

function normalizeSessions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).map(([sessionId, session]) => [
      sessionId,
      { changedFiles: Array.isArray(session?.changedFiles) ? [...session.changedFiles] : [] },
    ]),
  );
}

// v1 state는 만료되는 `lease`와 `pendingClaim`, prompt에서 읽은 session issue를 담았다. lease의 Linear
// 검증 기록만 claim으로 옮기고 나머지는 버린다. 예전 lease의 writer 결박은 holder가 아니다. 그 세션이
// 아직 살아 있는지 알 수 없는데 holder로 올리면 새 세션이 근거 없이 막힌다.
function normalizeWorktree(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { sessions: {} };
  const worktree = { sessions: normalizeSessions(value.sessions) };
  const claim = pickClaim(value.claim ?? value.lease);
  if (claim) worktree.claim = claim;
  if (value.holder && typeof value.holder === "object" && value.holder.sessionId) {
    worktree.holder = { ...value.holder };
  }
  return worktree;
}

function normalizeState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return createEmptyState();
  const worktrees =
    value.worktrees && typeof value.worktrees === "object" && !Array.isArray(value.worktrees)
      ? value.worktrees
      : {};
  return {
    version: STATE_VERSION,
    worktrees: Object.fromEntries(
      Object.entries(worktrees).map(([key, worktree]) => [key, normalizeWorktree(worktree)]),
    ),
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

function worktreeEntry(state, worktreeRoot) {
  return state.worktrees?.[worktreeKey(worktreeRoot)] ?? null;
}

function withWorktree(state, worktreeRoot, patch) {
  const key = worktreeKey(worktreeRoot);
  const worktree = state.worktrees?.[key] ?? { sessions: {} };
  return { ...state, worktrees: { ...state.worktrees, [key]: patch(worktree) } };
}

export function getSessionState(state, worktreeRoot, sessionId) {
  return worktreeEntry(state, worktreeRoot)?.sessions?.[String(sessionId)] ?? {};
}

export function getWorktreeSessions(state, worktreeRoot) {
  return worktreeEntry(state, worktreeRoot)?.sessions ?? {};
}

export function getWorktreeClaim(state, worktreeRoot) {
  return worktreeEntry(state, worktreeRoot)?.claim ?? null;
}

export function getWorktreeHolder(state, worktreeRoot) {
  return worktreeEntry(state, worktreeRoot)?.holder ?? null;
}

// state key는 정규화된 경로라 그 자체가 worktree root다. 삭제된 worktree처럼 세션 cwd로 root를
// 계산할 수 없을 때 issue 식별자만으로 claim을 찾는 유일한 경로다.
export function findWorktreesByIssue(state, issueIdentifier) {
  const normalized = String(issueIdentifier ?? "").toUpperCase();
  return Object.entries(state.worktrees ?? {})
    .filter(([, worktree]) => worktree?.claim?.issueIdentifier === normalized)
    .map(([worktreeRoot, worktree]) => ({
      claim: worktree.claim,
      holder: worktree.holder ?? null,
      worktreeRoot,
    }));
}

export function listWorktreeClaims(state) {
  return Object.entries(state.worktrees ?? {})
    .filter(([, worktree]) => worktree?.claim?.issueIdentifier)
    .map(([worktreeRoot, worktree]) => ({
      claim: worktree.claim,
      holder: worktree.holder ?? null,
      worktreeRoot,
    }));
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

export function setWorktreeClaim(state, worktreeRoot, claim) {
  const picked = pickClaim(claim);
  if (!picked) throw new Error("A worktree claim needs an issue identifier");
  return withWorktree(state, worktreeRoot, (worktree) => ({ ...worktree, claim: picked }));
}

export function clearWorktreeClaim(state, worktreeRoot) {
  const worktree = worktreeEntry(state, worktreeRoot);
  if (!worktree?.claim) return state;
  return withWorktree(state, worktreeRoot, ({ claim: _claim, ...rest }) => rest);
}

export function setWorktreeHolder(state, worktreeRoot, holder) {
  if (!holder?.sessionId) throw new Error("A worktree holder needs a session id");
  return withWorktree(state, worktreeRoot, (worktree) => ({ ...worktree, holder: { ...holder } }));
}

export function clearWorktreeHolder(state, worktreeRoot) {
  const worktree = worktreeEntry(state, worktreeRoot);
  if (!worktree?.holder) return state;
  return withWorktree(state, worktreeRoot, ({ holder: _holder, ...rest }) => rest);
}

export function updateSessionState(state, worktreeRoot, sessionId, patch) {
  return withWorktree(state, worktreeRoot, (worktree) => {
    const sessions = worktree.sessions ?? {};
    const currentSession = sessions[String(sessionId)] ?? {};
    return {
      ...worktree,
      sessions: { ...sessions, [String(sessionId)]: { ...currentSession, ...patch } },
    };
  });
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
