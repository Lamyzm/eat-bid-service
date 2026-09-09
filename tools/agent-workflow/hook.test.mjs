import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import test from "node:test";

import {
  createEmptyState,
  getSessionState,
  getWorktreeClaim,
  getWorktreeHolder,
  loadState,
  saveState,
  setWorktreeClaim,
  setWorktreeHolder,
  updateSessionState,
} from "./state.mjs";

const hookPath = path.resolve("tools/agent-workflow/hook.mjs");
const cliPath = path.resolve("tools/agent-workflow/cli.mjs");
const guardPath = path.resolve("tools/agent-workflow/commit-guard.mjs");

// 테스트는 Claude 세션의 Bash 안에서도 돌아간다. 부모의 세션 id·pid가 새어 들어오면 "이 세션"이 누구인지가
// 실행 환경에 따라 달라지므로 명시적으로 비운다.
function environmentFor(statePath, environment = {}) {
  return {
    ...process.env,
    CLAUDE_CODE_SESSION_ID: "",
    CLAUDE_PID: "",
    EATBID_WORKFLOW_STATE_PATH: statePath,
    LINEAR_API_KEY: "",
    ...environment,
  };
}

async function withTempDirectory(run) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "eatbid-hook-")));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

function runHook(input, statePath, environment = {}) {
  return spawnSync(process.execPath, [hookPath, "--provider", "test"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environmentFor(statePath, environment),
    input: JSON.stringify(input),
  });
}

function runCommand(command, statePath, commandArguments = [], environment = {}) {
  return spawnSync(process.execPath, [cliPath, command, ...commandArguments], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: environmentFor(statePath, environment),
  });
}

// stub 서버는 테스트 process의 event loop 위에서 응답하므로 spawnSync로 CLI를 기다리면 요청을
// 받을 수 없다. Linear를 부르는 명령만 비동기로 실행한다.
function runCommandAsync(command, statePath, commandArguments = [], environment = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [cliPath, command, ...commandArguments], {
      cwd: process.cwd(),
      env: environmentFor(statePath, environment),
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
        identifier: payload.variables?.id ?? "EAT-41",
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

const liveHolder = () => ({
  lastSeenAt: "2026-09-10T00:00:00.000Z",
  pid: process.pid,
  provider: "claude",
  sessionId: "other-session",
  startedAt: "2026-09-10T00:00:00.000Z",
});

test("실제 훅은 빈 worktree의 첫 쓰기 도구를 통과시키며 그 세션을 holder로 기록한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "first", tool_name: "Edit", tool_input: { file_path: "a.ts" } },
      statePath,
      { CLAUDE_PID: String(process.pid) },
    );
    const stored = await loadState(statePath);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(getWorktreeHolder(stored, process.cwd()).sessionId, "first");
    assert.equal(getWorktreeHolder(stored, process.cwd()).pid, process.pid);
  });
});

test("실제 훅은 다른 살아 있는 세션이 잡은 worktree에서 쓰기 도구를 차단하고 읽기와 lifecycle 명령은 연다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(statePath, setWorktreeHolder(createEmptyState(), process.cwd(), liveHolder()));

    const blocked = runHook(
      { hook_event_name: "PreToolUse", session_id: "second", tool_name: "Bash", tool_input: { command: "git status" } },
      statePath,
    );
    const read = runHook(
      { hook_event_name: "PreToolUse", session_id: "second", tool_name: "Read", tool_input: { file_path: "a" } },
      statePath,
    );
    const lifecycle = runHook(
      { hook_event_name: "PreToolUse", session_id: "second", tool_name: "Bash", tool_input: { command: "pnpm workflow:session take" } },
      statePath,
    );
    const stored = await loadState(statePath);

    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /other-session/);
    assert.match(blocked.stderr, /pnpm workflow:session take/);
    assert.equal(read.status, 0, read.stderr);
    assert.equal(lifecycle.status, 0, lifecycle.stderr);
    assert.equal(getWorktreeHolder(stored, process.cwd()).sessionId, "other-session");
  });
});

test("실제 훅은 죽은 세션의 잠금을 넘겨받고 systemMessage로 알린다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(
      statePath,
      setWorktreeHolder(createEmptyState(), process.cwd(), { ...liveHolder(), pid: 999999 }),
    );

    const result = runHook(
      { hook_event_name: "PreToolUse", session_id: "second", tool_name: "Write", tool_input: { file_path: "a" } },
      statePath,
    );
    const stored = await loadState(statePath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(JSON.parse(result.stdout).systemMessage, /넘겨받았습니다/);
    assert.equal(getWorktreeHolder(stored, process.cwd()).sessionId, "second");
  });
});

test("실제 PreToolUse는 상태가 손상되면 안전하게 차단하고 읽기 도구는 상태 파일을 만들거나 격리하지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const read = runHook(
      { hook_event_name: "PreToolUse", session_id: "read", tool_name: "Read" },
      statePath,
    );
    assert.equal(read.status, 0);
    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });

    await writeFile(statePath, "{broken", "utf8");
    const readAgain = runHook(
      { hook_event_name: "PreToolUse", session_id: "read", tool_name: "Grep" },
      statePath,
    );
    assert.equal(readAgain.status, 0);
    assert.equal(await readFile(statePath, "utf8"), "{broken");

    const edit = runHook(
      { hook_event_name: "PreToolUse", session_id: "corrupt", tool_name: "Edit" },
      statePath,
    );
    assert.equal(edit.status, 2);
    assert.match(edit.stderr, /quarantined/i);
  });
});

test("SessionStart는 잠금 결과를 stdout context로 알리고 UserPromptSubmit은 prompt 본문을 저장하지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(statePath, setWorktreeClaim(createEmptyState(), process.cwd(), { issueIdentifier: "EAT-41" }));

    const start = runHook({ hook_event_name: "SessionStart", session_id: "s", source: "startup" }, statePath);
    const prompt = runHook(
      { hook_event_name: "UserPromptSubmit", prompt: "EAT-99 민감한 설명", session_id: "s" },
      statePath,
    );
    const stored = await readFile(statePath, "utf8");

    assert.equal(start.status, 0, start.stderr);
    assert.match(start.stdout, /acquired/);
    assert.match(start.stdout, /EAT-41/);
    assert.equal(prompt.status, 0, prompt.stderr);
    assert.doesNotMatch(stored, /민감한 설명|EAT-99/);
  });
});

test("release는 claim을 지우기 전에 미완료 session 경로를 issue에 기록하고 세션 잠금은 남긴다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeClaim(createEmptyState(), process.cwd(), { issueIdentifier: "EAT-41", teamKey: "EAT" });
    state = setWorktreeHolder(state, process.cwd(), liveHolder());
    state = updateSessionState(state, process.cwd(), "other-session", { changedFiles: ["src/a.ts"] });
    await saveState(statePath, state);

    const release = runCommand("release", statePath);
    const stored = await loadState(statePath);

    assert.equal(release.status, 0, release.stderr);
    assert.equal(getWorktreeClaim(stored, process.cwd()), null);
    assert.equal(getWorktreeHolder(stored, process.cwd()).sessionId, "other-session");
    assert.deepEqual(getSessionState(stored, process.cwd(), "other-session").changedFiles, []);
    assert.deepEqual(
      stored.outbox.map((event) => ({ changedFiles: event.changedFiles, issue: event.issueIdentifier })),
      [{ changedFiles: ["src/a.ts"], issue: "EAT-41" }],
    );
  });
});

test("workflow session take는 살아 있는 holder를 끝난 것으로 표시해 다음 세션이 잡게 한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(statePath, setWorktreeHolder(createEmptyState(), process.cwd(), liveHolder()));

    const take = runCommand("session", statePath, ["take"]);
    const next = runHook(
      { hook_event_name: "PreToolUse", session_id: "second", tool_name: "Edit", tool_input: { file_path: "a" } },
      statePath,
    );
    const stored = await loadState(statePath);
    const again = runCommand("session", statePath, ["take"]);

    assert.equal(take.status, 0, take.stderr);
    assert.match(take.stdout, /other-session/);
    assert.equal(next.status, 0, next.stderr);
    assert.equal(getWorktreeHolder(stored, process.cwd()).sessionId, "second");
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /test\/second/);
    const noHolder = runCommand("session", statePath, ["take"]);
    assert.match(noHolder.stdout, /No live session lock/);
  });
});

function gitIn(cwd, args) {
  return spawnSync(
    "git",
    ["-C", cwd, "-c", "user.name=eatbid-test", "-c", "user.email=test@example.invalid", ...args],
    { encoding: "utf8" },
  );
}

async function withTempGitRepository(run) {
  await withTempDirectory(async (directory) => {
    const repository = path.join(directory, "other-worktree");
    await mkdir(repository);
    const init = gitIn(repository, ["init", "--quiet"]);
    assert.equal(init.status, 0, init.stderr);
    await run(repository, directory);
  });
}

test("--worktree 인자는 현재 cwd가 아니라 지정한 worktree의 claim을 release하고 doctor에 보고한다", async () => {
  await withTempGitRepository(async (repository, directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeClaim(createEmptyState(), process.cwd(), { issueIdentifier: "EAT-91", teamKey: "EAT" });
    state = setWorktreeClaim(state, repository, { issueIdentifier: "EAT-92", teamKey: "EAT" });
    state = setWorktreeHolder(state, repository, liveHolder());
    await saveState(statePath, state);

    const doctor = runCommand("doctor", statePath, ["--", "--worktree", repository]);
    const release = runCommand("release", statePath, ["--", "--worktree", repository]);
    const stored = await loadState(statePath);

    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.claim.issueIdentifier, "EAT-92");
    assert.equal(report.holder.sessionId, "other-session");
    assert.equal(report.holder.live, true);
    assert.equal(release.status, 0, release.stderr);
    assert.equal(getWorktreeClaim(stored, repository), null);
    assert.equal(getWorktreeClaim(stored, process.cwd()).issueIdentifier, "EAT-91");
  });
});

test("--worktree 경로가 없거나 git worktree가 아니면 claim을 건드리지 않고 실패한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await saveState(statePath, setWorktreeClaim(createEmptyState(), process.cwd(), { issueIdentifier: "EAT-91" }));
    const plainDirectory = path.join(directory, "plain");
    await mkdir(plainDirectory);

    const missing = runCommand("release", statePath, ["--worktree", path.join(directory, "missing")]);
    const plain = runCommand("release", statePath, ["--worktree", plainDirectory]);
    const stored = await loadState(statePath);

    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /worktree/i);
    assert.equal(plain.status, 1);
    assert.match(plain.stderr, /worktree/i);
    assert.equal(getWorktreeClaim(stored, process.cwd()).issueIdentifier, "EAT-91");
  });
});

test("--worktree로 지정한 worktree의 branch issue가 요청과 다르면 Linear 호출 전에 claim이 실패한다", async () => {
  await withTempGitRepository(async (repository, directory) => {
    const statePath = path.join(directory, "state.json");
    const checkout = gitIn(repository, ["checkout", "-q", "-b", "eat-99-other-work"]);
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
    env: environmentFor(statePath),
  });
}

// 유령 claim 재현에는 commit이 있는 main worktree와 거기서 add한 linked worktree가 필요하다.
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

test("worktree 디렉터리를 지운 뒤에도 issue 식별자로 release하면 유령 claim이 사라진다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    await saveState(statePath, setWorktreeClaim(createEmptyState(), linked, { issueIdentifier: "EAT-93", teamKey: "EAT" }));
    await rm(linked, { force: true, recursive: true });

    const byPath = runCommandIn(main, "release", statePath, ["--", "--worktree", linked]);
    const byIssue = runCommandIn(main, "release", statePath, ["--", "EAT-93"]);
    const again = runCommandIn(main, "release", statePath, ["--", "EAT-93"]);
    const both = runCommandIn(main, "release", statePath, ["--", "EAT-93", "--worktree", main]);
    const stored = await loadState(statePath);

    assert.equal(byPath.status, 1, byPath.stderr);
    assert.match(byPath.stderr, /does not exist/);
    assert.equal(byIssue.status, 0, byIssue.stderr);
    assert.match(byIssue.stdout, /EAT-93/);
    assert.equal(getWorktreeClaim(stored, linked), null);
    assert.equal(again.status, 1);
    assert.match(again.stderr, /No worktree claim exists for EAT-93/);
    assert.equal(both.status, 1);
    assert.match(both.stderr, /either an issue identifier or --worktree/);
  });
});

test("workflow worktree remove는 claim 해제와 git worktree remove를 한 번에 수행한다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    let state = setWorktreeClaim(createEmptyState(), linked, { issueIdentifier: "EAT-93", teamKey: "EAT" });
    state = updateSessionState(state, linked, "session-a", { changedFiles: ["a.ts"] });
    await saveState(statePath, state);

    const self = runCommandIn(linked, "worktree", statePath, ["remove", linked]);
    const removed = runCommandIn(main, "worktree", statePath, ["remove", linked]);
    const stored = await loadState(statePath);
    const list = gitIn(main, ["worktree", "list", "--porcelain"]);

    assert.equal(self.status, 1);
    assert.match(self.stderr, /running in/);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).git, "removed");
    assert.equal(getWorktreeClaim(stored, linked), null);
    assert.equal(Object.keys(stored.worktrees).length, 0);
    assert.deepEqual(
      stored.outbox.map((event) => ({ changedFiles: event.changedFiles, issue: event.issueIdentifier })),
      [{ changedFiles: ["a.ts"], issue: "EAT-93" }],
    );
    assert.doesNotMatch(list.stdout, /eat-93-ghost/);
    await assert.rejects(() => readFile(path.join(linked, ".git"), "utf8"), { code: "ENOENT" });
  });
});

test("dirty worktree는 git remove가 거부하므로 claim을 지우지 않는다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    await saveState(statePath, setWorktreeClaim(createEmptyState(), linked, { issueIdentifier: "EAT-93", teamKey: "EAT" }));
    await writeFile(path.join(linked, "dirty.txt"), "x", "utf8");

    const removed = runCommandIn(main, "worktree", statePath, ["remove", linked]);
    const stored = await loadState(statePath);

    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /git worktree remove .* failed/);
    assert.equal(getWorktreeClaim(stored, linked).issueIdentifier, "EAT-93");
  });
});

test("workflow worktree prune은 디렉터리가 사라진 worktree의 git 등록과 claim을 함께 정리한다", async () => {
  await withLinkedWorktree(async ({ linked, main, statePath }) => {
    let state = setWorktreeClaim(createEmptyState(), linked, { issueIdentifier: "EAT-93", teamKey: "EAT" });
    state = setWorktreeClaim(state, main, { issueIdentifier: "EAT-91", teamKey: "EAT" });
    await saveState(statePath, state);
    await rm(linked, { force: true, recursive: true });

    const pruned = runCommandIn(main, "worktree", statePath, ["prune"]);
    const stored = await loadState(statePath);
    const list = gitIn(main, ["worktree", "list", "--porcelain"]);

    assert.equal(pruned.status, 0, pruned.stderr);
    assert.equal(JSON.parse(pruned.stdout).pruned.length, 1);
    assert.equal(getWorktreeClaim(stored, linked), null);
    assert.equal(getWorktreeClaim(stored, main).issueIdentifier, "EAT-91");
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

test("claim은 Linear 검증 뒤 --branch로 브랜치를 만들고 검증 기록을 claim으로 남긴다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      const claim = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-41-guard"],
        environment,
      );
      const stored = await loadState(statePath);

      assert.equal(claim.status, 0, claim.stderr);
      assert.equal(gitIn(repository, ["branch", "--show-current"]).stdout.trim(), "eat-41-guard");
      const record = getWorktreeClaim(stored, repository);
      assert.equal(record.issueIdentifier, "EAT-41");
      assert.equal(record.branch, "eat-41-guard");
      assert.equal(record.assigneeId, "viewer");
      assert.equal(record.verifiedAt, record.claimedAt);
      assert.equal(record.expiresAt, undefined);
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["AgentWorkflowClaim", "AgentWorkflowClaimUpdate"],
      );
    });
  });
});

test("claim은 같은 worktree의 이전 claim을 대체하고 그 사실을 알린다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ environment }) => {
      await saveState(statePath, setWorktreeClaim(createEmptyState(), repository, { issueIdentifier: "EAT-40", teamKey: "EAT" }));
      const claim = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-41-guard"],
        environment,
      );
      const stored = await loadState(statePath);

      assert.equal(claim.status, 0, claim.stderr);
      assert.match(claim.stderr, /이전 claim EAT-40를 EAT-41로 바꿨습니다/);
      assert.equal(getWorktreeClaim(stored, repository).issueIdentifier, "EAT-41");
    });
  });
});

test("같은 issue를 다른 worktree의 살아 있는 세션이 쓰고 있으면 claim은 Linear 호출 전에 거부한다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      let state = setWorktreeClaim(createEmptyState(), "F:/elsewhere", { issueIdentifier: "EAT-41", teamKey: "EAT" });
      state = setWorktreeHolder(state, "F:/elsewhere", liveHolder());
      await saveState(statePath, state);

      const claim = await runCommandAsync("claim", statePath, ["--", "EAT-41", "--worktree", repository], environment);

      assert.equal(claim.status, 1);
      assert.match(claim.stderr, /EAT-41 is being written in f:\/elsewhere/i);
      assert.deepEqual(calls, []);
    });
  });
});

test("같은 issue의 죽은 claim은 새 worktree의 claim으로 옮겨진다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ environment }) => {
      let state = setWorktreeClaim(createEmptyState(), "F:/elsewhere", { issueIdentifier: "EAT-41", teamKey: "EAT" });
      state = setWorktreeHolder(state, "F:/elsewhere", { ...liveHolder(), pid: 999999 });
      await saveState(statePath, state);

      const claim = await runCommandAsync("claim", statePath, ["--", "EAT-41", "--worktree", repository], environment);
      const stored = await loadState(statePath);

      assert.equal(claim.status, 0, claim.stderr);
      assert.equal(getWorktreeClaim(stored, "F:/elsewhere"), null);
      assert.equal(getWorktreeClaim(stored, repository).issueIdentifier, "EAT-41");
    });
  });
});

test("--branch 이름의 이슈가 요청과 다르면 Linear를 부르기 전에 거부하고 dirty worktree는 Linear 검증 뒤 브랜치를 바꾸지 않는다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      const wrongName = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-99-other-work"],
        environment,
      );
      assert.equal(wrongName.status, 1);
      assert.match(wrongName.stderr, /Branch issue EAT-99 does not match requested claim EAT-41/);
      assert.deepEqual(calls, []);

      await writeFile(path.join(repository, "dirty.txt"), "x", "utf8");
      const dirty = await runCommandAsync(
        "claim",
        statePath,
        ["--", "EAT-41", "--worktree", repository, "--branch", "eat-41-guard"],
        environment,
      );
      assert.equal(dirty.status, 1);
      assert.match(dirty.stderr, /uncommitted changes/i);
      assert.equal(gitIn(repository, ["branch", "--show-current"]).stdout.trim(), "main");
      assert.deepEqual(calls.map((call) => call.operation), ["AgentWorkflowClaim", "AgentWorkflowClaimUpdate"]);
      await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
    });
  });
});

test("release 기본은 Linear 상태를 바꾸지 않고 --review일 때만 In Review로 보낸다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const claim = { issueIdentifier: "EAT-41", teamKey: "EAT" };
    await withLinearStub(async ({ calls, environment }) => {
      await saveState(statePath, setWorktreeClaim(createEmptyState(), process.cwd(), claim));
      const plain = await runCommandAsync("release", statePath, [], environment);
      assert.equal(plain.status, 0, plain.stderr);
      assert.deepEqual(calls, []);

      await saveState(statePath, setWorktreeClaim(createEmptyState(), process.cwd(), claim));
      const review = await runCommandAsync("release", statePath, ["--", "--review"], environment);
      const stored = await loadState(statePath);

      assert.equal(review.status, 0, review.stderr);
      assert.deepEqual(
        calls.map((call) => call.operation),
        ["AgentWorkflowIssue", "AgentWorkflowIssueUpdate"],
      );
      assert.equal(calls[1].variables.stateId, "review");
      assert.equal(getWorktreeClaim(stored, process.cwd()), null);
    });
  });
});

function runGuard(cwd, stage, statePath, stdin = "", environment = {}) {
  return spawnSync(process.execPath, [guardPath, stage], {
    cwd,
    encoding: "utf8",
    env: environmentFor(statePath, environment),
    input: stdin,
  });
}

test("commit guard는 issue branch의 커밋을 같은 issue의 claim이 있을 때만 통과시키고 main은 묻지 않는다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    const onMain = runGuard(repository, "pre-commit", statePath);
    assert.equal(onMain.status, 0, onMain.stderr);

    const checkout = gitIn(repository, ["checkout", "-q", "-b", "codex/eat-41-guard"]);
    assert.equal(checkout.status, 0, checkout.stderr);
    const missing = runGuard(repository, "pre-commit", statePath);
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /claim이 없습니다/);
    assert.match(missing.stderr, /pnpm workflow:claim -- EAT-41/);

    await saveState(statePath, setWorktreeClaim(createEmptyState(), repository, { issueIdentifier: "EAT-40" }));
    const mismatch = runGuard(repository, "pre-commit", statePath);
    assert.equal(mismatch.status, 1);
    assert.match(mismatch.stderr, /branch는 EAT-41, 이 worktree의 claim은 EAT-40/);

    await saveState(statePath, setWorktreeClaim(createEmptyState(), repository, { issueIdentifier: "EAT-41" }));
    const matching = runGuard(repository, "pre-commit", statePath);
    assert.equal(matching.status, 0, matching.stderr);
  });
});

test("pre-push guard는 push되는 issue branch만 검사하고 key가 없으면 재검증 생략을 알린다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await saveState(statePath, setWorktreeClaim(createEmptyState(), repository, { issueIdentifier: "EAT-41", claimedAt: "2026-09-10T00:00:00.000Z" }));
    const push = (refs) => runGuard(repository, "pre-push", statePath, refs);

    const mainOnly = push("refs/heads/main abc refs/heads/main def\n");
    assert.equal(mainOnly.status, 0, mainOnly.stderr);
    assert.equal(mainOnly.stderr.trim(), "");

    const matching = push("refs/heads/codex/eat-41-guard abc refs/heads/codex/eat-41-guard def\n");
    assert.equal(matching.status, 0, matching.stderr);
    assert.match(matching.stderr, /LINEAR_API_KEY가 없어 Linear 재검증은 생략/);

    const other = push("refs/heads/codex/eat-42-next abc refs/heads/codex/eat-42-next def\n");
    assert.equal(other.status, 1);
    assert.match(other.stderr, /branch는 EAT-42/);
  });
});

test("pre-push guard는 key가 있으면 Linear에 상태를 바꾸지 않고 재검증한다", async () => {
  await withCommittedRepository(async ({ repository, statePath }) => {
    await withLinearStub(async ({ calls, environment }) => {
      await saveState(statePath, setWorktreeClaim(createEmptyState(), repository, { issueIdentifier: "EAT-41", assigneeId: "viewer" }));
      const result = await new Promise((resolve) => {
        const child = spawn(process.execPath, [guardPath, "pre-push"], {
          cwd: repository,
          env: environmentFor(statePath, environment),
        });
        let stderr = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          stderr += chunk;
        });
        child.on("close", (status) => resolve({ status, stderr }));
        child.stdin.end("refs/heads/codex/eat-41-guard abc refs/heads/codex/eat-41-guard def\n");
      });

      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stderr, /Linear 재검증 통과: EAT-41/);
      assert.deepEqual(calls.map((call) => call.operation), ["AgentWorkflowClaim"]);
    });
  });
});
