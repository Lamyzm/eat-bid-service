/** @module 책임: worktree를 잡은 세션(holder)의 생존 판정과 획득·인수·heartbeat 전이를 순수 함수로 결정한다. */
import { getWorktreeHolder, setWorktreeHolder } from "./state.mjs";

// 도구 호출마다 state를 쓰면 매 호출이 lock을 잡는다. holder 확인은 읽기만으로 끝내고 heartbeat는
// 이 간격으로만 기록한다. pid가 없는 provider의 생존 판정 해상도가 이 값이다.
export const HEARTBEAT_INTERVAL_MS = 60_000;

export function defaultIsProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

/**
 * holder가 살아 있는지 판정한다. 명시적으로 끝난 세션(`endedAt`)은 죽은 것이고, pid를 아는 세션은
 * 프로세스 존재가 답이다. 사용자 입력을 기다리는 세션은 몇 시간이고 hook을 보내지 않으므로 pid를
 * 알면서 heartbeat로 판정하면 살아 있는 세션을 죽었다고 읽는다. pid를 모르는 provider만 heartbeat
 * 시각으로 판정한다.
 */
export function holderIsLive(holder, { now, isProcessAlive = defaultIsProcessAlive, staleAfterMs }) {
  if (!holder?.sessionId) return false;
  if (holder.endedAt) return false;
  if (Number.isInteger(holder.pid) && holder.pid > 0) return isProcessAlive(holder.pid);
  const lastSeen = Date.parse(holder.lastSeenAt ?? "");
  return Number.isFinite(lastSeen) && now().getTime() - lastSeen <= staleAfterMs;
}

function sameSession(holder, { provider, sessionId }) {
  return Boolean(holder?.sessionId) && holder.sessionId === sessionId && holder.provider === provider;
}

/**
 * 세션 하나가 worktree 하나를 잡는다. 같은 세션이면 heartbeat만 갱신하고, holder가 없거나 죽었으면
 * 이 세션이 잡으며, 다른 세션이 살아 있으면 `blocked`다. `nextState === state`면 쓸 것이 없다.
 */
export function resolveWorktreeHolder(
  state,
  worktreeRoot,
  { isProcessAlive = defaultIsProcessAlive, now = () => new Date(), pid = null, provider, sessionId, staleAfterMs },
) {
  const current = getWorktreeHolder(state, worktreeRoot);
  const timestamp = now().toISOString();

  if (sameSession(current, { provider, sessionId })) {
    const lastSeen = Date.parse(current.lastSeenAt ?? "");
    const stale = !Number.isFinite(lastSeen) || now().getTime() - lastSeen >= HEARTBEAT_INTERVAL_MS;
    const pidChanged = Number.isInteger(pid) && pid > 0 && current.pid !== pid;
    if (!stale && !pidChanged && !current.endedAt) {
      return { decision: "held", holder: current, nextState: state };
    }
    const { endedAt: _endedAt, ...rest } = current;
    const holder = { ...rest, lastSeenAt: timestamp, ...(pidChanged ? { pid } : {}) };
    return { decision: "held", holder, nextState: setWorktreeHolder(state, worktreeRoot, holder) };
  }

  if (holderIsLive(current, { isProcessAlive, now, staleAfterMs })) {
    return { decision: "blocked", holder: current, nextState: state };
  }

  const holder = {
    provider,
    sessionId,
    ...(Number.isInteger(pid) && pid > 0 ? { pid } : {}),
    startedAt: timestamp,
    lastSeenAt: timestamp,
  };
  return {
    decision: current?.sessionId ? "taken-over" : "acquired",
    holder,
    nextState: setWorktreeHolder(state, worktreeRoot, holder),
  };
}

// 끝난 holder를 지우지 않고 `endedAt`만 남긴다. 누가 마지막으로 잡았는지는 doctor와 인계에서 읽는 기록이다.
export function endWorktreeHolder(state, worktreeRoot, { now = () => new Date(), provider, sessionId } = {}) {
  const current = getWorktreeHolder(state, worktreeRoot);
  if (!current?.sessionId) return state;
  if (sessionId && !sameSession(current, { provider, sessionId })) return state;
  if (current.endedAt) return state;
  return setWorktreeHolder(state, worktreeRoot, { ...current, endedAt: now().toISOString() });
}

export function describeHolder(holder) {
  if (!holder?.sessionId) return "없음";
  const pid = Number.isInteger(holder.pid) ? `, pid ${holder.pid}` : "";
  const ended = holder.endedAt ? `, 종료 ${holder.endedAt}` : "";
  return `${holder.provider ?? "unknown"}/${holder.sessionId}${pid}, 마지막 활동 ${holder.lastSeenAt ?? "unknown"}${ended}`;
}

// 차단 메시지는 누가 잡고 있는지와 세션이 스스로 할 수 있는 복구 둘을 함께 말한다. 사용자에게 명령을
// 대신 쳐 달라고 부탁하는 것으로 끝나는 메시지는 만들지 않는다.
export function blockedByHolderMessage(holder, worktreeRoot) {
  return [
    `이 worktree는 다른 세션이 쓰고 있습니다: ${describeHolder(holder)} @ ${worktreeRoot}`,
    "읽기·조사는 계속할 수 있습니다. 쓰려면 EnterWorktree로 새 worktree에서 시작하거나, 그 세션이 끝난 것이",
    "확실하면 `pnpm workflow:session take`를 실행한 뒤 다시 시도하세요.",
  ].join("\n");
}
