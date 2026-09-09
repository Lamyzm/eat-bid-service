import assert from "node:assert/strict";
import test from "node:test";

import { handleHookEvent } from "./hook-runtime.mjs";
import {
  createEmptyState,
  getSessionState,
  getWorktreeHolder,
  setWorktreeClaim,
  setWorktreeHolder,
} from "./state.mjs";

const context = {
  config: { sessionStaleMinutes: 30 },
  createId: (() => {
    let id = 0;
    return () => `event-${++id}`;
  })(),
  isProcessAlive: () => true,
  now: () => new Date("2026-09-10T00:00:00.000Z"),
  pid: 100,
  provider: "claude",
  worktreeRoot: "F:/repo",
};

const heldByOther = () =>
  setWorktreeHolder(createEmptyState(), "F:/repo", {
    lastSeenAt: "2026-09-09T23:59:00.000Z",
    pid: 200,
    provider: "codex",
    sessionId: "other-session",
    startedAt: "2026-09-09T23:00:00.000Z",
  });

test("SessionStart는 빈 worktree를 잡고 잠금·claim 상태를 context로 알린다", () => {
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "SessionStart", session_id: "session-a" },
    state: setWorktreeClaim(createEmptyState(), "F:/repo", { issueIdentifier: "EAT-123" }),
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.context, /acquired/);
  assert.match(result.context, /EAT-123/);
  assert.equal(getWorktreeHolder(result.state, "F:/repo").sessionId, "session-a");
  assert.equal(getWorktreeHolder(result.state, "F:/repo").pid, 100);
});

test("SessionStart는 다른 살아 있는 세션이 잡은 worktree를 차단하지 않고 context로만 경고한다", () => {
  const state = heldByOther();
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "SessionStart", session_id: "session-a" },
    state,
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.context, /other-session/);
  assert.match(result.context, /EnterWorktree/);
  assert.equal(result.state, state);
});

test("PreToolUse는 holder 세션의 모든 도구를 통과시키고 명령 본문은 해석하지 않는다", () => {
  let state = createEmptyState();
  for (const [toolName, toolInput] of [
    ["Edit", { file_path: "src/a.ts" }],
    ["Bash", { command: "rm -rf build && git commit -m x > log 2>&1" }],
    ["mcp__linear__save_comment", { issueId: "x" }],
    ["Monitor", {}],
  ]) {
    const result = handleHookEvent({
      ...context,
      input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: toolName, tool_input: toolInput },
      state,
    });
    assert.equal(result.exitCode, 0, toolName);
    state = result.state;
  }
  assert.equal(getWorktreeHolder(state, "F:/repo").sessionId, "session-a");
});

test("PreToolUse는 다른 살아 있는 세션이 잡은 worktree에서 쓰기 도구를 차단하고 읽기 도구는 연다", () => {
  const state = heldByOther();
  const blocked = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: "Edit", tool_input: { file_path: "a" } },
    state,
  });
  assert.equal(blocked.exitCode, 2);
  assert.match(blocked.message, /codex\/other-session, pid 200/);
  assert.match(blocked.message, /pnpm workflow:session take/);
  assert.equal(blocked.state, state);

  for (const [toolName, toolInput] of [
    ["Read", { file_path: "a" }],
    ["Grep", {}],
    ["mcp__linear__get_issue", {}],
    ["Bash", { command: "pnpm workflow:session take" }],
    ["Bash", { command: "pnpm workflow:doctor -- --worktree ../x" }],
  ]) {
    const open = handleHookEvent({
      ...context,
      input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: toolName, tool_input: toolInput },
      state,
    });
    assert.equal(open.exitCode, 0, toolName);
  }
  const shell = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: "Bash", tool_input: { command: "git status" } },
    state,
  });
  assert.equal(shell.exitCode, 2);
});

test("PreToolUse는 죽은 세션의 잠금을 넘겨받고 systemMessage로 알린다", () => {
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: "Write", tool_input: { file_path: "a" } },
    isProcessAlive: () => false,
    state: heldByOther(),
  });

  assert.equal(result.exitCode, 0);
  assert.match(result.systemMessage, /넘겨받았습니다/);
  assert.match(result.systemMessage, /other-session/);
  assert.equal(getWorktreeHolder(result.state, "F:/repo").sessionId, "session-a");
});

test("사용자가 직접 실행한 도구 호출(initiated_by: user)은 잠금을 보지 않고 상태도 바꾸지 않는다", () => {
  const state = heldByOther();
  const result = handleHookEvent({
    ...context,
    input: {
      hook_event_name: "PreToolUse",
      initiated_by: "user",
      session_id: "session-a",
      tool_name: "Bash",
      tool_input: { command: "git commit -am x" },
    },
    state,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.state, state);
});

test("PostToolUse와 Stop은 편집 도구의 경로를 claim issue의 작업 기록 하나로 만든다", () => {
  let state = setWorktreeClaim(createEmptyState(), "F:/repo", { issueIdentifier: "EAT-42" });
  for (const [toolName, toolInput] of [
    ["Edit", { file_path: "F:/repo/src/a.ts" }],
    ["Write", { file_path: "src/b.ts" }],
    ["Edit", { file_path: "src/a.ts" }],
    ["Bash", { command: "echo x > c.ts" }],
  ]) {
    ({ state } = handleHookEvent({
      ...context,
      input: { hook_event_name: "PostToolUse", session_id: "session-a", tool_name: toolName, tool_input: toolInput },
      state,
    }));
  }
  assert.deepEqual(getSessionState(state, "F:/repo", "session-a").changedFiles, ["src/a.ts", "src/b.ts"]);

  const stopped = handleHookEvent({
    ...context,
    input: { hook_event_name: "Stop", session_id: "session-a" },
    state,
  });
  assert.equal(stopped.state.outbox.length, 1);
  assert.deepEqual(stopped.state.outbox[0].changedFiles, ["src/a.ts", "src/b.ts"]);
  assert.equal(stopped.state.outbox[0].issueIdentifier, "EAT-42");
  assert.deepEqual(getSessionState(stopped.state, "F:/repo", "session-a").changedFiles, []);
});

test("Codex apply_patch 작업 기록은 patch에 선언된 모든 경로를 포함한다", () => {
  const result = handleHookEvent({
    ...context,
    input: {
      hook_event_name: "PostToolUse",
      session_id: "codex",
      tool_name: "apply_patch",
      tool_input: {
        command: "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: docs/b.md\n*** Delete File: old.ts\n*** End Patch",
      },
    },
    state: createEmptyState(),
  });

  assert.deepEqual(getSessionState(result.state, "F:/repo", "codex").changedFiles, ["src/a.ts", "docs/b.md", "old.ts"]);
});

test("작업 기록에는 저장소 밖 경로가 포함되지 않고 claim이 없으면 outbox에 남기지 않는다", () => {
  let state = createEmptyState();
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PostToolUse", session_id: "s", tool_name: "Edit", tool_input: { file_path: "C:/elsewhere/x.ts" } },
    state,
  }));
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PostToolUse", session_id: "s", tool_name: "Edit", tool_input: { file_path: "src/ok.ts" } },
    state,
  }));
  assert.deepEqual(getSessionState(state, "F:/repo", "s").changedFiles, ["src/ok.ts"]);

  const stopped = handleHookEvent({ ...context, input: { hook_event_name: "Stop", session_id: "s" }, state });
  assert.deepEqual(stopped.state.outbox, []);
  assert.deepEqual(getSessionState(stopped.state, "F:/repo", "s").changedFiles, ["src/ok.ts"]);
});

test("SessionEnd는 자기 잠금만 끝내고 남은 작업 기록을 확정한다", () => {
  let state = setWorktreeClaim(createEmptyState(), "F:/repo", { issueIdentifier: "EAT-42" });
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: "Edit", tool_input: { file_path: "a" } },
    state,
  }));
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PostToolUse", session_id: "session-a", tool_name: "Edit", tool_input: { file_path: "src/a.ts" } },
    state,
  }));

  const otherEnd = handleHookEvent({ ...context, input: { hook_event_name: "SessionEnd", session_id: "someone-else" }, state });
  assert.equal(getWorktreeHolder(otherEnd.state, "F:/repo").endedAt, undefined);

  const ended = handleHookEvent({ ...context, input: { hook_event_name: "SessionEnd", session_id: "session-a" }, state });
  assert.equal(getWorktreeHolder(ended.state, "F:/repo").endedAt, "2026-09-10T00:00:00.000Z");
  assert.equal(ended.state.outbox.length, 1);

  const next = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-b", tool_name: "Edit", tool_input: { file_path: "a" } },
    state: ended.state,
  });
  assert.equal(next.exitCode, 0);
  assert.equal(getWorktreeHolder(next.state, "F:/repo").sessionId, "session-b");
});

test("UserPromptSubmit은 prompt 본문을 저장하지 않고 heartbeat만 갱신한다", () => {
  const state = setWorktreeHolder(createEmptyState(), "F:/repo", {
    lastSeenAt: "2026-09-09T00:00:00.000Z",
    pid: 100,
    provider: "claude",
    sessionId: "session-a",
  });
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "UserPromptSubmit", prompt: "EAT-999 비밀 설명", session_id: "session-a" },
    state,
  });

  assert.equal(result.exitCode, 0);
  assert.equal(getWorktreeHolder(result.state, "F:/repo").lastSeenAt, "2026-09-10T00:00:00.000Z");
  assert.doesNotMatch(JSON.stringify(result.state), /비밀 설명|EAT-999/);
});
