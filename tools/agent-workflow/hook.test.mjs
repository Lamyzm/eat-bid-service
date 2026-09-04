import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
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

function runCommand(command, statePath, commandArguments = [], environment = {}) {
  return spawnSync(process.execPath, [cliPath, command, ...commandArguments], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      EATBID_WORKFLOW_STATE_PATH: statePath,
      LINEAR_API_KEY: "",
      ...environment,
    },
  });
}

// stub 서버는 테스트 process의 event loop 위에서 응답하므로 spawnSync로 CLI를 기다리면 요청을
// 받을 수 없다. Linear를 부르는 명령만 비동기로 실행한다.
function runCommandAsync(command, statePath, commandArguments = [], environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, command, ...commandArguments], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        EATBID_WORKFLOW_STATE_PATH: statePath,
        LINEAR_API_KEY: "",
        ...environment,
      },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolve({ status, stderr, stdout }));
  });
}

// claim·release의 원격 전이는 실제 CLI 경로로만 증명할 수 있어서 client를 모듈로 갈아끼우는 대신
// 같은 GraphQL 계약을 말하는 최소 stub 서버를 띄우고 어떤 operation이 갔는지 기록으로 확인한다.
async function withLinearStub(run) {
  const calls = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(raw);
      const operation = payload.query.match(/(?:query|mutation)\s+(\w+)/)?.[1] ?? "unknown";
      calls.push({ operation, variables: payload.variables });
      const issue = {
        id: "issue-uuid",
        identifier: "EAT-41",
        assignee: null,
        state: { id: "backlog", name: "Backlog" },
        team: {
          key: "EAT",
          states: {
            nodes: [
              { id: "progress", name: "In Progress" },
              { id: "review", name: "In Review" },
            ],
          },
        },
      };
      const data = operation.endsWith("Update")
        ? { issueUpdate: { success: true } }
        : { issue, viewer: { id: "viewer", name: "Owner" } };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const environment = {
    EATBID_LINEAR_ENDPOINT: `http://127.0.0.1:${server.address().port}/graphql`,
    LINEAR_API_KEY: "stub-key",
  };
  try {
    await run({ calls, environment });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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

test("lease 없이도 git checkout -b는 통과한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    for (const command of [
      "git checkout -b eat-41-lease-gate",
      "git switch -c eat-41-lease-gate",
      "git branch eat-41-lease-gate",
      "git worktree add .worktrees/eat-41 -b eat-41-lease-gate",
    ]) {
      const result = runHook(
        {
          hook_event_name: "PreToolUse",
          session_id: "branch",
          tool_name: "Bash",
          tool_input: { command },
        },
        statePath,
      );
      assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    }
    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
  });
});

test("lease 없이 git commit은 여전히 막힌다", async () => {
  await withTempDirectory(async (directory) => {
    const result = runHook(
      {
        hook_event_name: "PreToolUse",
        session_id: "commit",
        tool_name: "Bash",
        tool_input: { command: "git commit -m 변경" },
      },
      path.join(directory, "state.json"),
    );

    assert.equal(result.status, 2);
    assert.match(result.stderr, /Linear lease/i);
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

function runCommandIn(cwd, command, statePath, commandArguments = []) {
  return spawnSync(process.execPath, [cliPath, command, ...commandArguments], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, EATBID_WORKFLOW_STATE_PATH: statePath, LINEAR_API_KEY: "" },
  });
}

function gitIn(cwd, args) {
  return spawnSync(
    "git",
    ["-C", cwd, "-c", "user.name=eatbid-test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8" },
  );
}

// 유령 lease 재현에는 commit이 있는 main worktree와 거기서 add한 linked worktree가 필요하다.
async function withLinkedWorktree(run) {
  await withTempDirectory(async (directory) => {
    const main = path.join(directory, "main");
    await mkdir(main);
    for (const args of [["init", "--quiet", "-b", "main"], ["commit", "--quiet", "--allow-empty", "-m", "init"]]) {
      const result = gitIn(main, args);
      assert.equal(result.status, 0, result.stderr);
    }
    const linked = path.join(directory, "linked", "eat-93-ghost");
    const add = gitIn(main, ["worktree", "add", "--quiet", linked, "-b", "eat-93-ghost"]);
    assert.equal(add.status, 0, add.stderr);
    await run({ directory, linked, main, statePath: path.join(directory, "state.json") });
  });
}

test("worktree 디렉터리를 지운 뒤에도 issue 식별자로 release하면 유령 lease가 사라진다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    await saveState(
      statePath,
      setWorktreeLease(createEmptyState(), linked, {
        issueIdentifier: "EAT-93",
        teamKey: "EAT",
        expiresAt: "2099-08-31T00:00:00.000Z",
        worktreeRoot: linked,
      }),
    );
    await rm(linked, { force: true, recursive: true });

    const byPath = runCommandIn(main, "release", statePath, ["--", "--worktree", linked]);
    const byIssue = runCommandIn(main, "release", statePath, ["--", "EAT-93"]);
    const again = runCommandIn(main, "release", statePath, ["--", "EAT-93"]);
    const stored = await loadState(statePath);

    assert.equal(byPath.status, 1, byPath.stderr);
    assert.match(byPath.stderr, /does not exist/);
    assert.equal(byIssue.status, 0, byIssue.stderr);
    assert.match(byIssue.stdout, /EAT-93/);
    assert.equal(getWorktreeLease(stored, linked), null);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /No worktree lease or pending claim exists for EAT-93/);
  });
});

test("issue 식별자 release는 같은 issue의 pending claim도 지우고 --worktree와 함께 오면 거부한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeLease(createEmptyState(), process.cwd(), {
      issueIdentifier: "EAT-91",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    });
    state = {
      ...state,
      worktrees: {
        ...state.worktrees,
        "f:/vanished": { pendingClaim: { attemptId: "a", issueIdentifier: "EAT-94" }, sessions: {} },
      },
    };
    await saveState(statePath, state);

    const both = runCommand("release", statePath, ["--", "EAT-91", "--worktree", process.cwd()]);
    const pending = runCommand("release", statePath, ["--", "EAT-94"]);
    const stored = await loadState(statePath);

    assert.equal(both.status, 1);
    assert.match(both.stderr, /either an issue identifier or --worktree/);
    assert.equal(pending.status, 0, pending.stderr);
    assert.equal(stored.worktrees["f:/vanished"].pendingClaim, undefined);
    assert.equal(getWorktreeLease(stored, process.cwd()).issueIdentifier, "EAT-91");
  });
});

test("workflow worktree remove는 lease 해제와 git worktree remove를 한 번에 수행한다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    let state = setWorktreeLease(createEmptyState(), linked, {
      issueIdentifier: "EAT-93",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
      writer: { provider: "test", sessionId: "session-a" },
    });
    state = updateSessionState(state, linked, "session-a", { activeIssue: "EAT-93", changedFiles: ["a.ts"] });
    await saveState(statePath, state);

    const self = runCommandIn(linked, "worktree", statePath, ["remove", linked]);
    const removed = runCommandIn(main, "worktree", statePath, ["remove", linked]);
    const stored = await loadState(statePath);
    const list = gitIn(main, ["worktree", "list", "--porcelain"]);

    assert.equal(self.status, 1);
    assert.match(self.stderr, /running in/);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).git, "removed");
    assert.equal(getWorktreeLease(stored, linked), null);
    assert.equal(Object.keys(stored.worktrees).length, 0);
    assert.deepEqual(
      stored.outbox.map((event) => ({ changedFiles: event.changedFiles, issue: event.issueIdentifier })),
      [{ changedFiles: ["a.ts"], issue: "EAT-93" }],
    );
    assert.doesNotMatch(list.stdout, /eat-93-ghost/);
    await assert.rejects(() => readFile(path.join(linked, ".git"), "utf8"), { code: "ENOENT" });
  });
});

test("dirty worktree는 git remove가 거부하므로 lease를 지우지 않는다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    await saveState(
      statePath,
      setWorktreeLease(createEmptyState(), linked, {
        issueIdentifier: "EAT-93",
        teamKey: "EAT",
        expiresAt: "2099-08-31T00:00:00.000Z",
      }),
    );
    await writeFile(path.join(linked, "dirty.txt"), "x", "utf8");

    const removed = runCommandIn(main, "worktree", statePath, ["remove", linked]);
    const stored = await loadState(statePath);

    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /git worktree remove .* failed/);
    assert.equal(getWorktreeLease(stored, linked).issueIdentifier, "EAT-93");
  });
});

test("workflow worktree prune은 디렉터리가 사라진 worktree의 git 등록과 lease를 함께 정리한다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    let state = setWorktreeLease(createEmptyState(), linked, {
      issueIdentifier: "EAT-93",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    });
    state = setWorktreeLease(state, main, {
      issueIdentifier: "EAT-91",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    });
    await saveState(statePath, state);
    await rm(linked, { force: true, recursive: true });

    const pruned = runCommandIn(main, "worktree", statePath, ["prune"]);
    const stored = await loadState(statePath);
    const list = gitIn(main, ["worktree", "list", "--porcelain"]);

    assert.equal(pruned.status, 0, pruned.stderr);
    assert.equal(JSON.parse(pruned.stdout).pruned.length, 1);
    assert.equal(getWorktreeLease(stored, linked), null);
    assert.equal(getWorktreeLease(stored, main).issueIdentifier, "EAT-91");
    assert.doesNotMatch(list.stdout, /eat-93-ghost/);
  });
});

// --branch는 commit이 하나라도 있어야 새 ref를 만들 수 있으므로 빈 commit이 있는 repository를 쓴다.
async function withCommittedRepository(run) {
  await withTempDirectory(async (directory) => {
    const repository = path.join(directory, "claimed");
    await mkdir(repository);
    for (const args of [["init", "--quiet", "-b", "main"], ["commit", "--quiet", "--allow-empty", "-m", "init"]]) {
      const result = gitIn(repository, args);
      assert.equal(result.status, 0, result.stderr);
    }
    await run({ repository, statePath: path.join(directory, "state.json") });
  });
}

test("--branch로 브랜치를 만들며 claim한다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      const claim = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-41-lease-gate"],
        environment,
      );
      const stored = await loadState(statePath);

      assert.equal(claim.status, 0, claim.stderr);
      assert.equal(gitIn(repository, ["branch", "--show-current"]).stdout.trim(), "eat-41-lease-gate");
      assert.equal(getWorktreeLease(stored, repository).issueIdentifier, "EAT-41");
      assert.equal(getWorktreeLease(stored, repository).branch, "eat-41-lease-gate");
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["AgentWorkflowClaim", "AgentWorkflowClaimUpdate"],
      );
    });
  });
});

test("dirty worktree에서는 --branch가 브랜치를 바꾸지 않고 claim을 거부한다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      await writeFile(path.join(repository, "dirty.txt"), "x", "utf8");
      const claim = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-41-lease-gate"],
        environment,
      );

      assert.equal(claim.status, 1);
      assert.match(claim.stderr, /uncommitted changes/i);
      assert.equal(gitIn(repository, ["branch", "--show-current"]).stdout.trim(), "main");
      assert.deepEqual(calls, []);
      await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
    });
  });
});

test("release 기본은 Linear 상태를 바꾸지 않고 --review일 때만 In Review로 보낸다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const lease = {
      issueIdentifier: "EAT-41",
      teamKey: "EAT",
      expiresAt: "2099-08-31T00:00:00.000Z",
    };
    await withLinearStub(async ({ calls, environment }) => {
      await saveState(statePath, setWorktreeLease(createEmptyState(), process.cwd(), lease));
      const plain = await runCommandAsync("release", statePath, [], environment);
      assert.equal(plain.status, 0, plain.stderr);
      assert.deepEqual(calls, []);

      await saveState(statePath, setWorktreeLease(createEmptyState(), process.cwd(), lease));
      const review = await runCommandAsync("release", statePath, ["--", "--review"], environment);
      const stored = await loadState(statePath);

      assert.equal(review.status, 0, review.stderr);
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["AgentWorkflowIssue", "AgentWorkflowIssueUpdate"],
      );
      assert.equal(calls[1].variables.stateId, "review");
      assert.equal(getWorktreeLease(stored, process.cwd()), null);
    });
  });
});
