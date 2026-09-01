import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createEmptyState,
  getWorktreeLease,
  loadState,
  saveState,
  setWorktreeLease,
  updateSessionState,
} from "./state.mjs";
import { repositoryContext } from "./runtime.mjs";
import { extractIssueIdentifier } from "./workflow.mjs";

const hookPath = path.resolve("tools/agent-workflow/hook.mjs");
const cliPath = path.resolve("tools/agent-workflow/cli.mjs");

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "eatbid-hook-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function runHook(input, statePath) {
  return spawnSync(process.execPath, [hookPath, "--provider", "test"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      EATBID_WORKFLOW_STATE_PATH: statePath,
      LINEAR_API_KEY: "",
    },
    input: JSON.stringify(input),
  });
}

function runCommand(command, statePath) {
  return spawnSync(process.execPath, [cliPath, command], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      EATBID_WORKFLOW_STATE_PATH: statePath,
      LINEAR_API_KEY: "",
    },
  });
}

test("실제 훅은 검증된 Linear lease가 없는 편집을 차단한다", async () => {
  await withTempDirectory(async (directory) => {
    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "blocked", tool_name: "Edit" },
      path.join(directory, "state.json"),
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Linear lease/i);
  });
});

test("실제 훅은 prompt 본문을 저장하지 않고 검증된 offline lease를 허용한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const issueIdentifier = extractIssueIdentifier(repositoryContext(process.cwd()).branch) ?? "EAT-91";
    await saveState(
      statePath,
      setWorktreeLease(createEmptyState(), process.cwd(), {
        issueIdentifier,
        teamKey: "EAT",
        expiresAt: "2099-08-31T00:00:00.000Z",
      }),
    );
    const promptResult = runHook(
      {
        hook_event_name: "UserPromptSubmit",
        prompt: `${issueIdentifier} 구현해줘. 민감한 설명은 저장하면 안 됨`,
        session_id: "offline",
      },
      statePath,
    );
    const editResult = runHook(
      { hook_event_name: "PreToolUse", session_id: "offline", tool_name: "Write" },
      statePath,
    );
    const stored = await readFile(statePath, "utf8");

    assert.equal(promptResult.status, 0);
    assert.equal(editResult.status, 0);
    assert.match(stored, new RegExp(issueIdentifier));
    assert.doesNotMatch(stored, /민감한 설명/);
  });
});

test("실제 PreToolUse는 상태가 손상되면 안전하게 차단한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await writeFile(statePath, "{broken", "utf8");
    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "corrupt", tool_name: "Edit" },
      statePath,
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /quarantined/i);
  });
});

test("읽기 전용 훅은 상태 파일이 없어도 생성하지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "read", tool_name: "Read" },
      statePath,
    );

    assert.equal(result.status, 0);
    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
  });
});

test("읽기 전용 훅은 손상된 상태 파일을 읽거나 격리하지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await writeFile(statePath, "{broken", "utf8");
    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "read", tool_name: "Read" },
      statePath,
    );

    assert.equal(result.status, 0);
    assert.equal(await readFile(statePath, "utf8"), "{broken");
  });
});

test("release는 lease를 지우기 전에 미완료 session 경로를 원래 issue에 기록한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeLease(createEmptyState(), process.cwd(), {
      issueIdentifier: "EAT-91",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
      writer: { provider: "codex", sessionId: "session-a" },
    });
    state = updateSessionState(state, process.cwd(), "session-a", {
      activeIssue: "EAT-91",
      changedFiles: ["src/a.ts"],
    });
    await saveState(statePath, state);

    const result = runCommand("release", statePath);
    const stored = await loadState(statePath);

    assert.equal(result.status, 0);
    assert.equal(getWorktreeLease(stored, process.cwd()), null);
    assert.deepEqual(
      stored.outbox.map((event) => ({ changedFiles: event.changedFiles, issue: event.issueIdentifier })),
      [{ changedFiles: ["src/a.ts"], issue: "EAT-91" }],
    );
  });
});
