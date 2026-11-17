import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { locateRepository } from "./runtime.mjs";

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
    const add = git(main, ["worktree", "add", "--quiet", linked, "-b", "chore/1-linked"]);
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

    const plain = path.join(directory, "plain");
    await mkdir(plain);
    await writeFile(path.join(plain, ".git"), "not a pointer\n", "utf8");
    assert.equal(locateRepository(plain).isGitWorktree, false);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
