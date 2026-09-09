import assert from "node:assert/strict";
import test from "node:test";

import {
  blockedByHolderMessage,
  endWorktreeHolder,
  holderIsLive,
  resolveWorktreeHolder,
} from "./session.mjs";
import { createEmptyState, getWorktreeHolder, setWorktreeHolder } from "./state.mjs";

const at = (iso) => () => new Date(iso);
const root = "F:/repo";
const staleAfterMs = 30 * 60 * 1000;

test("holder가 없는 worktree는 첫 세션이 잡고 heartbeat와 pid를 기록한다", () => {
  const result = resolveWorktreeHolder(createEmptyState(), root, {
    now: at("2026-09-10T00:00:00.000Z"),
    pid: 4242,
    provider: "claude",
    sessionId: "session-a",
    staleAfterMs,
  });

  assert.equal(result.decision, "acquired");
  assert.deepEqual(getWorktreeHolder(result.nextState, root), {
    lastSeenAt: "2026-09-10T00:00:00.000Z",
    pid: 4242,
    provider: "claude",
    sessionId: "session-a",
    startedAt: "2026-09-10T00:00:00.000Z",
  });
});

test("같은 세션은 1분 안에는 state를 쓰지 않고 그 뒤에는 heartbeat만 갱신한다", () => {
  const state = setWorktreeHolder(createEmptyState(), root, {
    lastSeenAt: "2026-09-10T00:00:00.000Z",
    pid: 4242,
    provider: "claude",
    sessionId: "session-a",
    startedAt: "2026-09-10T00:00:00.000Z",
  });
  const identity = { pid: 4242, provider: "claude", sessionId: "session-a", staleAfterMs };

  const soon = resolveWorktreeHolder(state, root, { ...identity, now: at("2026-09-10T00:00:30.000Z") });
  assert.equal(soon.decision, "held");
  assert.equal(soon.nextState, state);

  const later = resolveWorktreeHolder(state, root, { ...identity, now: at("2026-09-10T00:05:00.000Z") });
  assert.equal(later.decision, "held");
  assert.equal(getWorktreeHolder(later.nextState, root).lastSeenAt, "2026-09-10T00:05:00.000Z");
  assert.equal(getWorktreeHolder(later.nextState, root).startedAt, "2026-09-10T00:00:00.000Z");
});

test("pid를 아는 holder는 프로세스가 살아 있으면 heartbeat가 오래돼도 살아 있다", () => {
  const holder = {
    lastSeenAt: "2026-09-09T00:00:00.000Z",
    pid: 4242,
    provider: "claude",
    sessionId: "session-a",
  };
  const now = at("2026-09-10T00:00:00.000Z");

  assert.equal(holderIsLive(holder, { isProcessAlive: () => true, now, staleAfterMs }), true);
  assert.equal(holderIsLive(holder, { isProcessAlive: () => false, now, staleAfterMs }), false);
});

test("pid를 모르는 holder는 heartbeat가 stale 한도 안일 때만 살아 있다", () => {
  const holder = { lastSeenAt: "2026-09-10T00:00:00.000Z", provider: "codex", sessionId: "s" };
  const isProcessAlive = () => {
    throw new Error("pid 없는 holder는 프로세스를 묻지 않는다");
  };

  assert.equal(holderIsLive(holder, { isProcessAlive, now: at("2026-09-10T00:29:00.000Z"), staleAfterMs }), true);
  assert.equal(holderIsLive(holder, { isProcessAlive, now: at("2026-09-10T00:31:00.000Z"), staleAfterMs }), false);
  assert.equal(holderIsLive({ ...holder, endedAt: "2026-09-10T00:01:00.000Z" }, { isProcessAlive, now: at("2026-09-10T00:02:00.000Z"), staleAfterMs }), false);
});

test("다른 세션이 살아 있으면 blocked이고 죽었으면 넘겨받는다", () => {
  const state = setWorktreeHolder(createEmptyState(), root, {
    lastSeenAt: "2026-09-10T00:00:00.000Z",
    pid: 4242,
    provider: "claude",
    sessionId: "session-a",
    startedAt: "2026-09-10T00:00:00.000Z",
  });
  const identity = { now: at("2026-09-10T00:00:10.000Z"), pid: 7, provider: "codex", sessionId: "session-b", staleAfterMs };

  const blocked = resolveWorktreeHolder(state, root, { ...identity, isProcessAlive: () => true });
  assert.equal(blocked.decision, "blocked");
  assert.equal(blocked.holder.sessionId, "session-a");
  assert.equal(blocked.nextState, state);

  const taken = resolveWorktreeHolder(state, root, { ...identity, isProcessAlive: () => false });
  assert.equal(taken.decision, "taken-over");
  assert.equal(getWorktreeHolder(taken.nextState, root).sessionId, "session-b");
  assert.equal(getWorktreeHolder(taken.nextState, root).pid, 7);
});

test("endWorktreeHolder는 지정한 세션의 잠금만 끝내고 기록은 남긴다", () => {
  const state = setWorktreeHolder(createEmptyState(), root, {
    lastSeenAt: "2026-09-10T00:00:00.000Z",
    provider: "claude",
    sessionId: "session-a",
  });
  const now = at("2026-09-10T00:10:00.000Z");

  const other = endWorktreeHolder(state, root, { now, provider: "claude", sessionId: "session-b" });
  assert.equal(other, state);

  const ended = endWorktreeHolder(state, root, { now, provider: "claude", sessionId: "session-a" });
  assert.equal(getWorktreeHolder(ended, root).endedAt, "2026-09-10T00:10:00.000Z");
  assert.equal(getWorktreeHolder(ended, root).sessionId, "session-a");

  const anyone = endWorktreeHolder(state, root, { now });
  assert.equal(getWorktreeHolder(anyone, root).endedAt, "2026-09-10T00:10:00.000Z");
});

test("차단 메시지는 holder와 세션이 스스로 할 수 있는 복구를 함께 말한다", () => {
  const message = blockedByHolderMessage(
    { lastSeenAt: "2026-09-10T00:00:00.000Z", pid: 4242, provider: "claude", sessionId: "session-a" },
    root,
  );

  assert.match(message, /claude\/session-a, pid 4242/);
  assert.match(message, /EnterWorktree/);
  assert.match(message, /pnpm workflow:session take/);
  assert.doesNotMatch(message, /사용자에게/);
});
