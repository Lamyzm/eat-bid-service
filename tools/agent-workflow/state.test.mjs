import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  clearWorktreeClaim,
  clearWorktreeHolder,
  createEmptyState,
  enqueueEvent,
  findWorktreesByIssue,
  getSessionState,
  getWorktreeClaim,
  getWorktreeHolder,
  listWorktreeClaims,
  loadState,
  removeWorktreeEntry,
  saveState,
  setWorktreeClaim,
  setWorktreeHolder,
  updateSessionState,
} from "./state.mjs";
import {
  inspectStateLock,
  recoverStateLock,
  recoverWorkflowLock,
  withStateTransaction,
  withWorkflowLock,
} from "./state-lock.mjs";

async function withTempDirectory(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "eatbid-workflow-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

test("상태는 각 worktree의 독립적인 session 변경 기록을 보존한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = await loadState(statePath);
    state = updateSessionState(state, "F:/repo-a", "session-1", { changedFiles: ["a.ts"] });
    state = updateSessionState(state, "F:/repo-b", "session-1", { changedFiles: ["b.ts"] });
    await saveState(statePath, state);

    const reloaded = await loadState(statePath);
    assert.deepEqual(getSessionState(reloaded, "F:/repo-a", "session-1").changedFiles, ["a.ts"]);
    assert.deepEqual(getSessionState(reloaded, "F:/repo-b", "session-1").changedFiles, ["b.ts"]);
  });
});

test("enqueueEvent는 FIFO 순서를 보존하고 입력 상태를 변경하지 않는다", () => {
  const initial = createEmptyState();
  const first = enqueueEvent(initial, { id: "one", issueIdentifier: "EAT-1", kind: "worklog" });
  const second = enqueueEvent(first, { id: "two", issueIdentifier: "EAT-1", kind: "worklog" });

  assert.deepEqual(initial.outbox, []);
  assert.deepEqual(second.outbox.map((event) => event.id), ["one", "two"]);
});

test("loadState는 잘못된 JSON을 격리하고 안전하게 실패한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await writeFile(statePath, "{broken", "utf8");

    await assert.rejects(
      () => loadState(statePath, { now: () => new Date("2026-08-30T00:00:00.000Z") }),
      /quarantined/i,
    );
    const files = await readdir(directory);

    assert.ok(files.some((name) => name.startsWith("state.json.corrupt-2026-08-30T00-00-00-000Z")));
    assert.equal(await readFile(path.join(directory, files.find((name) => name.includes(".corrupt-"))), "utf8"), "{broken");
  });
});

test("worktree claim은 Linear 검증 필드만 남기고 영속화되며 session 기록과 섞이지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeClaim(await loadState(statePath), "F:/repo", {
      assigneeId: "viewer",
      assigneeName: "Owner",
      branch: "codex/eat-7-thing",
      claimedAt: "2026-09-10T00:00:00.000Z",
      expiresAt: "2026-09-11T00:00:00.000Z",
      issueId: "issue-uuid",
      issueIdentifier: "EAT-7",
      teamKey: "EAT",
      writer: { sessionId: "old" },
    });
    await saveState(statePath, state);
    state = await loadState(statePath);

    assert.deepEqual(getWorktreeClaim(state, "F:/repo"), {
      assigneeId: "viewer",
      assigneeName: "Owner",
      branch: "codex/eat-7-thing",
      claimedAt: "2026-09-10T00:00:00.000Z",
      issueId: "issue-uuid",
      issueIdentifier: "EAT-7",
      teamKey: "EAT",
      verifiedAt: "2026-09-10T00:00:00.000Z",
    });
    assert.deepEqual(getSessionState(state, "F:/repo", "new-session"), {});
    assert.equal(getWorktreeClaim(clearWorktreeClaim(state, "F:/repo"), "F:/repo"), null);
    assert.throws(() => setWorktreeClaim(state, "F:/repo", { teamKey: "EAT" }), /issue identifier/);
  });
});

test("v1 lease state는 claim으로 읽히고 pendingClaim·writer·prompt issue 기록은 버려진다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await writeFile(
      statePath,
      JSON.stringify({
        version: 1,
        worktrees: {
          "f:/repo": {
            lease: {
              issueIdentifier: "EAT-41",
              teamKey: "EAT",
              claimedAt: "2026-09-09T00:00:00.000Z",
              expiresAt: "2026-09-09T12:00:00.000Z",
              writer: { provider: "claude", sessionId: "old-session" },
            },
            pendingClaim: { attemptId: "a", issueIdentifier: "EAT-42" },
            sessions: {
              "old-session": { activeIssue: "EAT-41", requestedIssue: "EAT-9", changedFiles: ["src/a.ts"] },
            },
          },
        },
        outbox: [{ id: "e1", kind: "worklog", issueIdentifier: "EAT-41" }],
      }),
      "utf8",
    );

    const state = await loadState(statePath);

    assert.equal(state.version, 2);
    assert.equal(getWorktreeClaim(state, "F:/repo").issueIdentifier, "EAT-41");
    assert.equal(getWorktreeClaim(state, "F:/repo").verifiedAt, "2026-09-09T00:00:00.000Z");
    assert.equal(getWorktreeClaim(state, "F:/repo").expiresAt, undefined);
    assert.equal(getWorktreeHolder(state, "F:/repo"), null);
    assert.equal(state.worktrees["f:/repo"].pendingClaim, undefined);
    assert.deepEqual(getSessionState(state, "F:/repo", "old-session"), { changedFiles: ["src/a.ts"] });
    assert.equal(state.outbox.length, 1);
  });
});

test("holder는 worktree마다 하나이고 claim과 독립적으로 지워진다", () => {
  let state = setWorktreeClaim(createEmptyState(), "F:/repo", { issueIdentifier: "EAT-7" });
  state = setWorktreeHolder(state, "F:/repo", { provider: "claude", sessionId: "s-1", lastSeenAt: "x" });

  assert.equal(getWorktreeHolder(state, "F:/repo").sessionId, "s-1");
  assert.equal(getWorktreeHolder(clearWorktreeHolder(state, "F:/repo"), "F:/repo"), null);
  assert.equal(getWorktreeClaim(clearWorktreeHolder(state, "F:/repo"), "F:/repo").issueIdentifier, "EAT-7");
  assert.throws(() => setWorktreeHolder(state, "F:/repo", { provider: "claude" }), /session id/);
});

test("issue 조회는 claim이 있는 worktree와 그 holder를 함께 돌려주고 항목 삭제는 다른 worktree를 보존한다", () => {
  let state = setWorktreeClaim(createEmptyState(), "F:/repo", { issueIdentifier: "EAT-7" });
  state = setWorktreeHolder(state, "F:/repo", { provider: "claude", sessionId: "s-1" });
  state = setWorktreeClaim(state, "F:/repo/.worktrees/x", { issueIdentifier: "EAT-8" });

  const matches = findWorktreesByIssue(state, "eat-7");
  assert.equal(matches.length, 1);
  assert.equal(matches[0].holder.sessionId, "s-1");
  assert.deepEqual(
    listWorktreeClaims(state).map((entry) => entry.claim.issueIdentifier).sort(),
    ["EAT-7", "EAT-8"],
  );

  const removed = removeWorktreeEntry(state, "F:/repo");
  assert.equal(getWorktreeClaim(removed, "F:/repo"), null);
  assert.equal(getWorktreeClaim(removed, "F:/repo/.worktrees/x").issueIdentifier, "EAT-8");
});

test("상태 transaction은 동시 hook process의 갱신을 잃지 않고 직렬화한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        withStateTransaction(statePath, async (state) =>
          enqueueEvent(state, { id: String(index), issueIdentifier: "EAT-1", kind: "worklog" }),
        ),
      ),
    );

    const state = await loadState(statePath);
    assert.equal(state.outbox.length, 12);
    assert.deepEqual(new Set(state.outbox.map((event) => event.id)).size, 12);
  });
});

test("상태가 바뀌지 않은 트랜잭션은 상태 파일을 만들지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    await withStateTransaction(statePath, async (state) => state);

    await assert.rejects(() => readFile(statePath, "utf8"), { code: "ENOENT" });
  });
});

test("원격 sync 전용 lock은 hook 상태 transaction을 막지 않는다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let releaseSync;
    let notifyLocked;
    const locked = new Promise((resolve) => {
      notifyLocked = resolve;
    });
    const release = new Promise((resolve) => {
      releaseSync = resolve;
    });
    const syncing = withWorkflowLock(statePath, "sync", async () => {
      notifyLocked();
      await release;
    });
    await locked;

    await withStateTransaction(statePath, async (state) =>
      enqueueEvent(state, { id: "during-sync", issueIdentifier: "EAT-1", kind: "worklog" }),
    );
    releaseSync();
    await syncing;

    assert.equal((await loadState(statePath)).outbox[0].id, "during-sync");
  });
});

test("오래된 lock 복구는 종료된 소유자의 lock만 격리하고 활성 소유자는 거부한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const lockPath = `${statePath}.lock`;
    await mkdir(lockPath);
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 999999, createdAt: "2026-08-30T00:00:00.000Z" }),
      "utf8",
    );

    const inspected = await inspectStateLock(statePath);
    assert.equal(inspected.exists, true);
    assert.equal(inspected.ownerAlive, false);
    const recovered = await recoverStateLock(statePath, {
      now: () => new Date("2026-08-30T00:10:00.000Z"),
    });
    assert.match(recovered.quarantinePath, /\.lock\.recovered-/);

    await mkdir(lockPath);
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: process.pid, createdAt: "2026-08-30T00:09:59.000Z" }),
      "utf8",
    );
    await assert.rejects(() => recoverStateLock(statePath), /still active/i);
  });
});

test("비정상 종료로 남은 sync lock도 복구 명령이 격리한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    const lockPath = `${statePath}.sync.lock`;
    await mkdir(lockPath);
    await writeFile(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 999999, createdAt: "2026-08-30T00:00:00.000Z" }),
      "utf8",
    );

    const recovered = await recoverWorkflowLock(statePath, "sync", {
      now: () => new Date("2026-08-30T00:10:00.000Z"),
    });

    assert.equal(recovered.recovered, true);
    assert.match(recovered.quarantinePath, /\.sync\.lock\.recovered-/);
  });
});
