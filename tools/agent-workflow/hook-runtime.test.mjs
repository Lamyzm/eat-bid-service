import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyState, getSessionState, getWorktreeLease, setWorktreeLease } from "./state.mjs";
import { handleHookEvent } from "./hook-runtime.mjs";

const context = {
  branch: "master",
  config: { inProgressState: "In Progress" },
  createId: (() => {
    let id = 0;
    return () => `event-${++id}`;
  })(),
  now: () => new Date("2026-08-30T00:00:00.000Z"),
  provider: "test-agent",
  worktreeRoot: "F:/repo",
};

test("검증된 Linear lease가 없으면 저장소 변경을 차단한다", () => {
  const result = handleHookEvent({
    ...context,
    input: {
      hook_event_name: "PreToolUse",
      session_id: "session-1",
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts" },
    },
    state: createEmptyState(),
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /Linear lease/i);
  assert.deepEqual(result.state.outbox, []);
});

test("검증된 lease와 일치하는 prompt는 중복 시작 이벤트 없이 변경을 활성화한다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "UserPromptSubmit", prompt: "EAT-42 구현해줘", session_id: "session-1" },
    state,
  }));
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-1", tool_name: "Write" },
    state,
  }));
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "session-1", tool_name: "Edit" },
    state,
  }));

  assert.equal(getSessionState(state, "F:/repo", "session-1").activeIssue, "EAT-42");
  assert.deepEqual(state.outbox, []);
});

test("PostToolUse와 Stop은 session 경로를 중복 제거한 작업 기록 하나로 만든다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  for (const input of [
    { hook_event_name: "UserPromptSubmit", prompt: "EAT-42", session_id: "session-1" },
    { hook_event_name: "PreToolUse", session_id: "session-1", tool_name: "Edit" },
    {
      hook_event_name: "PostToolUse",
      session_id: "session-1",
      tool_name: "Edit",
      tool_input: { file_path: "src/a.ts" },
    },
    { hook_event_name: "Stop", session_id: "session-1" },
    { hook_event_name: "Stop", session_id: "session-1" },
  ]) {
    ({ state } = handleHookEvent({ ...context, input, state }));
  }

  assert.deepEqual(
    state.outbox.map((event) => ({ changedFiles: event.changedFiles, kind: event.kind })),
    [{ changedFiles: ["src/a.ts"], kind: "worklog" }],
  );
});

test("Codex apply_patch 작업 기록은 patch에 선언된 모든 경로를 포함한다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  for (const input of [
    { hook_event_name: "UserPromptSubmit", prompt: "EAT-42", session_id: "codex" },
    { hook_event_name: "PreToolUse", session_id: "codex", tool_name: "apply_patch" },
    {
      hook_event_name: "PostToolUse",
      session_id: "codex",
      tool_name: "apply_patch",
      tool_input: {
        command:
          "*** Begin Patch\n*** Update File: src/a.ts\n*** Add File: docs/a.md\n*** End Patch",
      },
    },
    { hook_event_name: "Stop", session_id: "codex" },
  ]) {
    ({ state } = handleHookEvent({ ...context, input, state }));
  }

  assert.deepEqual(state.outbox.at(-1).changedFiles, ["docs/a.md", "src/a.ts"]);
});

test("작업 기록에는 저장소 밖 경로와 제어 문자가 포함되지 않는다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  for (const filePath of ["../secret.txt", "F:/outside/secret.txt", "src/a.ts\nInjected"]) {
    ({ state } = handleHookEvent({
      ...context,
      input: {
        hook_event_name: "PostToolUse",
        session_id: "paths",
        tool_name: "Edit",
        tool_input: { file_path: filePath },
      },
      state,
    }));
  }

  assert.deepEqual(getSessionState(state, "F:/repo", "paths").changedFiles ?? [], []);
});

test("검증된 lease와 다른 prompt나 branch는 변경을 차단한다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "UserPromptSubmit", prompt: "EAT-99를 구현", session_id: "switch" },
    state,
  }));
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "switch", tool_name: "Edit" },
    state,
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /does not match/i);
});

test("첫 변경 session이 lease를 소유하고 두 번째 agent session은 차단된다", () => {
  let state = setWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-42",
    expiresAt: "2026-08-31T00:00:00.000Z",
  });
  ({ state } = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "codex-session", tool_name: "Edit" },
    provider: "codex",
    state,
  }));
  const result = handleHookEvent({
    ...context,
    input: { hook_event_name: "PreToolUse", session_id: "claude-session", tool_name: "Edit" },
    provider: "claude",
    state,
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.message, /writing session/i);
  assert.deepEqual(getWorktreeLease(state, "F:/repo").writer, {
    boundAt: "2026-08-30T00:00:00.000Z",
    provider: "codex",
    sessionId: "codex-session",
  });
});
