import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  claimWorktreeLease,
  createEmptyState,
  enqueueEvent,
  getSessionState,
  getPendingWorktreeClaim,
  getWorktreeLease,
  loadState,
  saveState,
  reserveWorktreeClaim,
  finalizePendingWorktreeClaim,
  setWorktreeLease,
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

test("상태는 각 worktree의 독립적인 session 기록을 보존한다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = await loadState(statePath);
    state = updateSessionState(state, "F:/repo-a", "session-1", { activeIssue: "EAT-10" });
    state = updateSessionState(state, "F:/repo-b", "session-1", { activeIssue: "EAT-20" });
    await saveState(statePath, state);

    const reloaded = await loadState(statePath);
    assert.equal(getSessionState(reloaded, "F:/repo-a", "session-1").activeIssue, "EAT-10");
    assert.equal(getSessionState(reloaded, "F:/repo-b", "session-1").activeIssue, "EAT-20");
  });
});

test("enqueueEvent는 FIFO 순서를 보존하고 입력 상태를 변경하지 않는다", () => {
  const initial = { version: 1, worktrees: {}, outbox: [] };
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

test("worktree lease는 session 소유 상태가 되지 않고 영속화된다", async () => {
  await withTempDirectory(async (directory) => {
    const statePath = path.join(directory, "state.json");
    let state = setWorktreeLease(await loadState(statePath), "F:/repo", {
      issueIdentifier: "EAT-7",
      expiresAt: "2026-08-31T00:00:00.000Z",
    });
    await saveState(statePath, state);
    state = await loadState(statePath);

    assert.equal(getWorktreeLease(state, "F:/repo").issueIdentifier, "EAT-7");
    assert.deepEqual(getSessionState(state, "F:/repo", "new-session"), {});
  });
});

test("하나의 issue는 두 worktree에서 활성 lease를 가질 수 없다", () => {
  const now = () => new Date("2026-08-30T00:00:00.000Z");
  const first = claimWorktreeLease(createEmptyState(), "F:/repo-a", {
    issueIdentifier: "EAT-7",
    expiresAt: "2026-08-31T00:00:00.000Z",
  }, { now });

  assert.throws(
    () => claimWorktreeLease(first, "F:/repo-b", {
      issueIdentifier: "EAT-7",
      expiresAt: "2026-08-31T00:00:00.000Z",
    }, { now }),
    /already leased/i,
  );
});

test("활성 worktree lease는 다른 issue를 claim하기 전에 해제해야 한다", () => {
  const now = () => new Date("2026-08-30T00:00:00.000Z");
  const first = claimWorktreeLease(createEmptyState(), "F:/repo", {
    issueIdentifier: "EAT-7",
    expiresAt: "2026-08-31T00:00:00.000Z",
  }, { now });

  assert.throws(
    () => claimWorktreeLease(first, "F:/repo", {
      issueIdentifier: "EAT-8",
      expiresAt: "2026-08-31T00:00:00.000Z",
    }, { now }),
    /release/i,
  );
});

test("원격 claim 전에 예약하고 같은 시도만 최종 lease로 확정한다", () => {
  const now = () => new Date("2026-08-30T00:00:00.000Z");
  const pending = {
    attemptId: "attempt-1",
    issueIdentifier: "EAT-7",
    expiresAt: "2026-08-31T00:00:00.000Z",
    requestedAt: "2026-08-30T00:00:00.000Z",
  };
  const reserved = reserveWorktreeClaim(createEmptyState(), "F:/repo", pending, { now });

  assert.deepEqual(getPendingWorktreeClaim(reserved, "F:/repo"), pending);
  assert.throws(
    () => reserveWorktreeClaim(reserved, "F:/repo", { ...pending, issueIdentifier: "EAT-8" }, { now }),
    /pending/i,
  );
  assert.throws(
    () => finalizePendingWorktreeClaim(reserved, "F:/repo", "other-attempt", pending, { now }),
    /attempt/i,
  );

  const finalized = finalizePendingWorktreeClaim(
    reserved,
    "F:/repo",
    pending.attemptId,
    { ...pending, teamKey: "EAT" },
    { now },
  );
  assert.equal(getPendingWorktreeClaim(finalized, "F:/repo"), null);
  assert.equal(getWorktreeLease(finalized, "F:/repo").issueIdentifier, "EAT-7");
});

test("같은 issue는 서로 다른 worktree에서 pending claim을 예약할 수 없다", () => {
  const now = () => new Date("2026-08-30T00:00:00.000Z");
  const first = reserveWorktreeClaim(
    createEmptyState(),
    "F:/repo-a",
    {
      attemptId: "attempt-a",
      issueIdentifier: "EAT-7",
      expiresAt: "2026-08-31T00:00:00.000Z",
    },
    { now },
  );

  assert.throws(
    () =>
      reserveWorktreeClaim(
        first,
        "F:/repo-b",
        {
          attemptId: "attempt-b",
          issueIdentifier: "EAT-7",
          expiresAt: "2026-08-31T00:00:00.000Z",
        },
        { now },
      ),
    /pending claim.*another worktree/i,
  );
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
