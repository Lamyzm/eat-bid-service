import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  createEmptyState,
  getSessionState,
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

function runCommand(command, statePath, commandArguments = []) {
  return spawnSync(process.execPath, [cliPath, command, ...commandArguments], {
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

test("실제 훅은 lease가 없어도 workflow claim 명령과 Linear 읽기 도구를 허용한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const claim = runHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "bootstrap",
        tool_name: "Bash",
        tool_input: { command: "pnpm workflow:claim -- EAT-26" },
      },
      statePath,
    );
    const read = runHook(
      { hook_event_name: "PreToolUse", session_id: "bootstrap", tool_name: "mcp__linear__get_issue" },
      statePath,
    );

    assert.equal(claim.status, 0, claim.stderr);
    assert.equal(read.status, 0, read.stderr);
    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
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

test("release는 session의 issue 기록을 지워 같은 session이 다음 issue를 prompt 없이 이어서 쓸 수 있게 한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeLease(createEmptyState(), process.cwd(), {
      issueIdentifier: "EAT-91",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
      writer: { provider: "test", sessionId: "session-a" },
    });
    state = updateSessionState(state, process.cwd(), "session-a", {
      activeIssue: "EAT-91",
      requestedIssue: "EAT-91",
    });
    await saveState(statePath, state);

    assert.equal(runCommand("release", statePath).status, 0);
    const released = await loadState(statePath);
    await saveState(
      statePath,
      setWorktreeLease(released, process.cwd(), {
        issueIdentifier: extractIssueIdentifier(repositoryContext(process.cwd()).branch) ?? "EAT-92",
        teamKey: "EAT",
        expiresAt: "2099-08-31T00:00:00.000Z",
      }),
    );
    const edit = runHook(
      { hook_event_name: "PreToolUse", session_id: "session-a", tool_name: "Edit" },
      statePath,
    );

    assert.deepEqual(getSessionState(released, process.cwd(), "session-a"), {});
    assert.equal(edit.status, 0, edit.stderr);
  });
});

async function withTempGitRepository(run) {
  await withTempDirectory(async (directory) => {
    const repository = path.join(directory, "other-worktree");
    await mkdir(repository);
    const init = spawnSync("git", ["-C", repository, "init", "--quiet"], { encoding: "utf8" });
    assert.equal(init.status, 0, init.stderr);
    await run(repository, directory);
  });
}

test("--worktree 인자는 현재 cwd가 아니라 지정한 worktree의 lease를 release하고 doctor에 보고한다", async () => {
  await withTempGitRepository(async (repository, directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeLease(createEmptyState(), process.cwd(), {
      issueIdentifier: "EAT-91",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    });
    state = setWorktreeLease(state, repository, {
      issueIdentifier: "EAT-92",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    });
    await saveState(statePath, state);

    const doctor = runCommand("doctor", statePath, ["--", "--worktree", repository]);
    const release = runCommand("release", statePath, ["--", "--worktree", repository]);
    const stored = await loadState(statePath);

    assert.equal(doctor.status, 0, doctor.stderr);
    assert.equal(JSON.parse(doctor.stdout).lease.issueIdentifier, "EAT-92");
    assert.equal(release.status, 0, release.stderr);
    assert.equal(getWorktreeLease(stored, repository), null);
    assert.equal(getWorktreeLease(stored, process.cwd()).issueIdentifier, "EAT-91");
  });
});

test("--worktree 경로가 없거나 git worktree가 아니면 lease를 건드리지 않고 실패한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(
      statePath,
      setWorktreeLease(createEmptyState(), process.cwd(), {
        issueIdentifier: "EAT-91",
        teamKey: "EAT",
        expiresAt: "2099-08-31T00:00:00.000Z",
      }),
    );
    const plainDirectory = path.join(directory, "plain");
    await mkdir(plainDirectory);

    const missing = runCommand("release", statePath, ["--worktree", path.join(directory, "missing")]);
    const plain = runCommand("release", statePath, ["--worktree", plainDirectory]);
    const stored = await loadState(statePath);

    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /worktree/i);
    assert.equal(plain.status, 1);
    assert.match(plain.stderr, /worktree/i);
    assert.equal(getWorktreeLease(stored, process.cwd()).issueIdentifier, "EAT-91");
  });
});

test("--worktree로 지정한 worktree의 branch issue가 요청과 다르면 Linear 호출 전에 claim이 실패한다", async () => {
  await withTempGitRepository(async (repository, directory) => {
    const statePath = path.join(directory, "state.json");
    const checkout = spawnSync("git", ["-C", repository, "checkout", "-q", "-b", "eat-99-other-work"], {
      encoding: "utf8",
    });
    assert.equal(checkout.status, 0, checkout.stderr);

    const claim = runCommand("claim", statePath, ["--", "EAT-27", "--worktree", repository]);

    assert.equal(claim.status, 1);
    assert.match(claim.stderr, /Branch issue EAT-99 does not match requested claim EAT-27/);
    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
  });
});
