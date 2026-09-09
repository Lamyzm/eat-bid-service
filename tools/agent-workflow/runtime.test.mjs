import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { currentSessionIdentity, locateRepository, resolveLinearEndpoint, statePathFor } from "./runtime.mjs";

const official = "https://api.linear.app/graphql";

test("Linear endpoint override는 loopback host만 허용하고 나머지는 경고와 함께 무시한다", () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);

  for (const override of [
    "http://127.0.0.1:5321/graphql",
    "http://localhost:5321/graphql",
    "http://[::1]:5321/graphql",
  ]) {
    assert.equal(resolveLinearEndpoint(override, official, warn), override);
  }
  assert.deepEqual(warnings, []);

  for (const override of [
    "https://evil.example.com/graphql",
    "https://api.linear.app.evil.example.com/graphql",
    "http://127.0.0.1.evil.example.com/graphql",
    "not a url",
  ]) {
    assert.equal(resolveLinearEndpoint(override, official, warn), official, override);
  }
  assert.equal(warnings.length, 4);
  assert.match(warnings[0], /loopback host만 허용/);

  assert.equal(resolveLinearEndpoint(undefined, official, warn), official);
  assert.equal(resolveLinearEndpoint("", official, warn), official);
  assert.equal(warnings.length, 4);
});

function git(cwd, args) {
  return spawnSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    encoding: "utf8",
  });
}

test("locateRepository는 git을 실행하지 않고 main checkout과 linked worktree의 root·common dir을 찾는다", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "eatbid-runtime-")));
  try {
    const main = path.join(directory, "main");
    await mkdir(main);
    for (const args of [["init", "--quiet", "-b", "main"], ["commit", "--quiet", "--allow-empty", "-m", "init"]]) {
      const result = git(main, args);
      assert.equal(result.status, 0, result.stderr);
    }
    const linked = path.join(directory, "linked");
    const add = git(main, ["worktree", "add", "--quiet", linked, "-b", "eat-1-linked"]);
    assert.equal(add.status, 0, add.stderr);
    await mkdir(path.join(linked, "deep", "er"), { recursive: true });

    const fromMain = locateRepository(path.join(main));
    assert.equal(fromMain.isGitWorktree, true);
    assert.equal(fromMain.worktreeRoot, main);
    assert.equal(fromMain.commonDirectory, path.join(main, ".git"));

    const fromLinked = locateRepository(path.join(linked, "deep", "er"));
    assert.equal(fromLinked.isGitWorktree, true);
    assert.equal(fromLinked.worktreeRoot, linked);
    assert.equal(path.resolve(fromLinked.commonDirectory), path.join(main, ".git"));
    assert.equal(
      statePathFor(fromLinked.commonDirectory),
      process.env.EATBID_WORKFLOW_STATE_PATH
        ? path.resolve(process.env.EATBID_WORKFLOW_STATE_PATH)
        : path.join(main, ".git", "eatbid-agent-workflow", "state.json"),
    );

    const plain = path.join(directory, "plain");
    await mkdir(plain);
    await writeFile(path.join(plain, ".git"), "not a pointer\n", "utf8");
    assert.equal(locateRepository(plain).isGitWorktree, false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("currentSessionIdentity는 Claude child 환경의 세션 id와 pid만 읽고 없으면 모른다고 답한다", () => {
  assert.deepEqual(currentSessionIdentity({ CLAUDE_CODE_SESSION_ID: "abc", CLAUDE_PID: "4242" }), {
    pid: 4242,
    provider: "claude",
    sessionId: "abc",
  });
  assert.deepEqual(currentSessionIdentity({}), { pid: null, provider: null, sessionId: null });
  assert.deepEqual(currentSessionIdentity({ CLAUDE_PID: "x" }), { pid: null, provider: null, sessionId: null });
});
