import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { isOutsideRepositoryRoots, resolveRealPath } from "./repository-paths.mjs";

const identity = (value) => value;
const win32 = { platform: "win32", realPath: identity };
const ROOTS = [
  "F:/Project/eat-bid-service/.claude/worktrees/eat-53-agent-self-service",
  "F:/Project/eat-bid-service/.git",
  "F:/Project/eat-bid-service",
];

test("어떤 저장소 루트에도 속하지 않는 절대 경로만 밖으로 판정한다", () => {
  assert.equal(
    isOutsideRepositoryRoots("C:/Users/kano/.claude/memory/note.md", ROOTS, win32),
    true,
  );
  assert.equal(isOutsideRepositoryRoots("F:/Project/other/README.md", ROOTS, win32), true);
  assert.equal(isOutsideRepositoryRoots("F:/Project/eat-bid-service/AGENTS.md", ROOTS, win32), false);
  assert.equal(
    isOutsideRepositoryRoots("F:/Project/eat-bid-service/.git/hooks/pre-commit", ROOTS, win32),
    false,
  );
});

test("Windows 대소문자와 백슬래시 표기가 달라도 같은 저장소 파일로 본다", () => {
  for (const candidate of [
    "f:/project/eat-bid-service/AGENTS.md",
    "F:\\Project\\eat-bid-service\\AGENTS.md",
    "F:/Project/eat-bid-service/tools/../AGENTS.md",
  ]) {
    assert.equal(isOutsideRepositoryRoots(candidate, ROOTS, win32), false, candidate);
  }
});

test("루트 자신을 가리키는 경로는 밖이 아니다", () => {
  assert.equal(isOutsideRepositoryRoots("F:/Project/eat-bid-service", ROOTS, win32), false);
  assert.equal(isOutsideRepositoryRoots("F:/Project/eat-bid-service/", ROOTS, win32), false);
});

test("접두사만 같은 형제 디렉터리는 저장소 안으로 오인하지 않는다", () => {
  assert.equal(isOutsideRepositoryRoots("F:/Project/eat-bid-service-old/a.md", ROOTS, win32), true);
});

test("장치 표기는 벗겨 판정하고 UNC와 제어문자와 상대 경로는 밖이라고 말하지 않는다", () => {
  assert.equal(
    isOutsideRepositoryRoots("\\\\?\\F:\\Project\\eat-bid-service\\AGENTS.md", ROOTS, win32),
    false,
  );
  assert.equal(
    isOutsideRepositoryRoots("\\\\?\\C:\\Users\\kano\\.claude\\note.md", ROOTS, win32),
    true,
  );
  for (const candidate of [
    "\\\\localhost\\F$\\Project\\eat-bid-service\\tools\\x.mjs",
    "\\\\?\\UNC\\localhost\\F$\\Project\\x.mjs",
    "C:/Users/kano/note.md\u0001",
    "../../outside.md",
    "",
  ]) {
    assert.equal(isOutsideRepositoryRoots(candidate, ROOTS, win32), false, JSON.stringify(candidate));
  }
});

test("루트 목록이 비었거나 루트를 해석하지 못하면 밖이라고 말하지 않는다", () => {
  assert.equal(isOutsideRepositoryRoots("C:/Users/kano/note.md", [], win32), false);
  assert.equal(isOutsideRepositoryRoots("C:/Users/kano/note.md", null, win32), false);
  const failingRealPath = () => {
    throw new Error("해석 불가");
  };
  assert.equal(
    isOutsideRepositoryRoots("C:/Users/kano/note.md", ROOTS, {
      platform: "win32",
      realPath: failingRealPath,
    }),
    false,
  );
});

test("아직 없는 파일도 존재하는 조상까지 실제 경로로 해석해 판정한다", () => {
  const base = mkdtempSync(path.join(tmpdir(), "eatbid-paths-"));
  const nested = path.join(base, "a", "b");
  mkdirSync(nested, { recursive: true });
  writeFileSync(path.join(nested, "there.md"), "x");

  const missing = path.join(nested, "c", "d", "not-created-yet.md");
  assert.equal(resolveRealPath(missing), path.resolve(missing));
  assert.equal(resolveRealPath(path.join(nested, "there.md")), path.resolve(nested, "there.md"));
  // 존재하지 않는 새 파일이어도 조상이 루트 안이면 안으로 판정한다.
  assert.equal(isOutsideRepositoryRoots(missing, [base]), false);
  assert.equal(isOutsideRepositoryRoots(missing, [path.join(base, "other")]), true);
});
