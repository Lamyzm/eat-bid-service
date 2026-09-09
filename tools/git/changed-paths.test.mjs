import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CHANGED_BASE_ENV,
  CHANGED_PATHS_ENV,
  changedScope,
  describeScope,
  listChangedPaths,
  resolveChangedBase,
} from "./changed-paths.mjs";

function repository({ branch = "main" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-changed-paths-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", branch);
  git("config", "user.name", "검증 사용자");
  git("config", "user.email", "quality@example.com");
  git("config", "commit.gpgsign", "false");
  const write = (files) => {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, source, "utf8");
    }
  };
  const commit = (message, files = {}) => {
    write(files);
    git("add", "-A");
    git("commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };
  return { root, git, write, commit, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("main과 갈라진 branch는 main과의 merge-base를 기준으로 삼는다", () => {
  const repo = repository();
  try {
    const fork = repo.commit("초기 코드", { "src/a.ts": "export const a = 1;\n" });
    repo.git("checkout", "-q", "-b", "feature");
    repo.commit("branch 작업", { "src/b.ts": "export const b = 2;\n" });
    repo.git("checkout", "-q", "main");
    repo.commit("main 진행", { "src/c.ts": "export const c = 3;\n" });
    repo.git("checkout", "-q", "feature");

    const base = resolveChangedBase({ repoRoot: repo.root });
    assert.equal(base.kind, "merge-base");
    assert.equal(base.ref, "main");
    assert.equal(base.commit, fork);
    assert.deepEqual(listChangedPaths({ repoRoot: repo.root, baseCommit: base.commit }), ["src/b.ts"]);
  } finally {
    repo.close();
  }
});

test("main 자체에서는 origin/main보다 앞선 commit과 작업 트리 변경만 범위가 된다", () => {
  const repo = repository();
  try {
    const pushed = repo.commit("초기 코드", { "src/a.ts": "export const a = 1;\n" });
    repo.git("update-ref", "refs/remotes/origin/main", pushed);
    assert.equal(resolveChangedBase({ repoRoot: repo.root }).kind, "head");

    repo.commit("push 전 commit", { "src/b.ts": "export const b = 2;\n" });
    repo.write({ "src/c.ts": "export const c = 3;\n" });
    const base = resolveChangedBase({ repoRoot: repo.root });
    assert.equal(base.kind, "merge-base");
    assert.equal(base.ref, "origin/main");
    assert.deepEqual(listChangedPaths({ repoRoot: repo.root, baseCommit: base.commit }), ["src/b.ts", "src/c.ts"]);
  } finally {
    repo.close();
  }
});

test("기준 branch가 하나도 없으면 unresolved를 돌려주고 명시한 base가 없으면 실패한다", () => {
  const repo = repository({ branch: "trunk" });
  try {
    repo.commit("초기 코드", { "src/a.ts": "export const a = 1;\n" });
    assert.equal(resolveChangedBase({ repoRoot: repo.root }).kind, "unresolved");
    assert.throws(() => resolveChangedBase({ repoRoot: repo.root, base: "nope" }), /해석하지 못했습니다/u);
    assert.throws(() => resolveChangedBase({ repoRoot: repo.root, base: "--output=x" }), /안전하지 않은/u);
    assert.equal(resolveChangedBase({ repoRoot: repo.root, base: "trunk" }).kind, "explicit");
  } finally {
    repo.close();
  }
});

test("변경 경로에는 untracked 파일이 들어가고 삭제된 파일은 빠진다", () => {
  const repo = repository();
  try {
    const base = repo.commit("초기 코드", {
      "src/keep.ts": "export const keep = 1;\n",
      "src/remove.ts": "export const remove = 1;\n",
    });
    repo.git("checkout", "-q", "-b", "feature");
    rmSync(path.join(repo.root, "src", "remove.ts"));
    repo.write({ "src/keep.ts": "export const keep = 2;\n", "src/new.ts": "export const fresh = 1;\n" });

    assert.deepEqual(listChangedPaths({ repoRoot: repo.root, baseCommit: base }), ["src/keep.ts", "src/new.ts"]);
  } finally {
    repo.close();
  }
});

test("범위 판정은 드라이버 env 목록, --all, --base, 자동 탐색 순서를 따른다", () => {
  const repo = repository();
  try {
    const fork = repo.commit("초기 코드", { "src/a.ts": "export const a = 1;\n" });
    repo.git("checkout", "-q", "-b", "feature");
    repo.commit("branch 작업", { "src/b.ts": "export const b = 2;\n" });

    const fromDriver = changedScope({
      repoRoot: repo.root,
      argv: [],
      env: { [CHANGED_PATHS_ENV]: "x/y.ts\nz.py", [CHANGED_BASE_ENV]: "main@abc1234" },
    });
    assert.equal(fromDriver.mode, "changed");
    assert.deepEqual([...fromDriver.paths], ["x/y.ts", "z.py"]);
    assert.match(describeScope(fromDriver), /드라이버 전달\(main@abc1234\) 2개 경로/u);

    assert.equal(changedScope({ repoRoot: repo.root, argv: ["--", "--all"], env: {} }).mode, "all");

    const explicit = changedScope({ repoRoot: repo.root, argv: ["--base", "main"], env: {} });
    assert.equal(explicit.base.kind, "explicit");
    assert.equal(explicit.base.commit, fork);
    assert.deepEqual([...explicit.paths], ["src/b.ts"]);

    const automatic = changedScope({ repoRoot: repo.root, argv: [], env: {} });
    assert.equal(automatic.base.kind, "merge-base");
    assert.match(describeScope(automatic), /main@[0-9a-f]{7} merge-base 이후 1개 경로/u);

    assert.equal(changedScope({ repoRoot: repo.root, argv: [], env: {}, defaultMode: "all" }).mode, "all");
    assert.equal(changedScope({ repoRoot: repo.root, argv: ["--changed"], env: {}, defaultMode: "all" }).mode, "changed");
    // 예외 없는 규칙은 base만으로 좁히지 않는다. CI가 base를 명시해도 전체 판정을 유지해야 한다.
    assert.equal(changedScope({ repoRoot: repo.root, argv: ["--base", "main"], env: {}, defaultMode: "all" }).mode, "all");
    assert.equal(changedScope({ repoRoot: repo.root, argv: [], env: { [CHANGED_BASE_ENV]: "main" }, defaultMode: "all" }).mode, "all");
    assert.equal(changedScope({ repoRoot: repo.root, argv: ["--changed", "--base", "main"], env: {}, defaultMode: "all" }).base.kind, "explicit");
    assert.equal(changedScope({ repoRoot: repo.root, argv: [], env: { [CHANGED_BASE_ENV]: "main" } }).base.kind, "explicit");
    // 값이 빠진 --base는 어느 검사에서도 자동 탐색으로 강등되지 않는다.
    assert.throws(() => changedScope({ repoRoot: repo.root, argv: ["--base"], env: {} }), /--base 옵션에는 ref 값이 필요/u);
    assert.throws(() => changedScope({ repoRoot: repo.root, argv: ["--base", "--all"], env: {}, defaultMode: "all" }), /--base 옵션에는 ref 값이 필요/u);
  } finally {
    repo.close();
  }
});

test("기준을 찾지 못한 범위는 unresolved 모드로 이유를 남긴다", () => {
  const repo = repository({ branch: "trunk" });
  try {
    repo.commit("초기 코드", { "src/a.ts": "export const a = 1;\n" });
    const scope = changedScope({ repoRoot: repo.root, argv: [], env: {} });
    assert.equal(scope.mode, "unresolved");
    assert.match(describeScope(scope), /미정/u);
  } finally {
    repo.close();
  }
});
