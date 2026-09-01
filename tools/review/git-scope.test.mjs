import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectReviewScope } from "./git-scope.mjs";

function repository() {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-review-scope-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "검증 사용자");
  git("config", "user.email", "review@example.com");
  writeFileSync(path.join(root, "README.md"), "초기\n", "utf8");
  git("add", "README.md");
  git("commit", "-qm", "초기 커밋");
  return { root, git, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("깨끗한 ancestor 기준의 변경 경로와 크기를 계산한다", () => {
  const fixture = repository();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.root,
      encoding: "utf8",
    }).trim();
    writeFileSync(path.join(fixture.root, "review.ts"), "export const 검증값 = true;\n", "utf8");
    fixture.git("add", "review.ts");
    fixture.git("commit", "-qm", "검증 파일 추가");

    const scope = inspectReviewScope({ repoRoot: fixture.root, baseRef: base });
    assert.equal(scope.ok, true);
    assert.deepEqual(scope.changedPaths, ["review.ts"]);
    assert.ok(scope.patchBytes > 0);
    assert.match(scope.patch, /^diff --git a\/review\.ts b\/review\.ts/m);
    assert.match(scope.patch, /\+export const 검증값 = true;/);
  } finally {
    fixture.close();
  }
});

test("삭제된 민감 경로도 patch에 본문이 남으므로 denied-path로 거부한다", () => {
  const fixture = repository();
  try {
    writeFileSync(path.join(fixture.root, ".env"), "SECRET=삭제될값\n", "utf8");
    fixture.git("add", ".env");
    fixture.git("commit", "-qm", "민감 파일 커밋");
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
    fixture.git("rm", "-q", ".env");
    fixture.git("commit", "-qm", "민감 파일 삭제");

    const scope = inspectReviewScope({ repoRoot: fixture.root, baseRef: base });
    assert.equal(scope.category, "denied-path");
    assert.equal(scope.patch, undefined);
  } finally {
    fixture.close();
  }
});

test("민감 경로에서 평범한 경로로 rename해도 old 본문이 patch에 남으므로 거부한다", () => {
  const fixture = repository();
  try {
    const kept = Array.from({ length: 12 }, (_, index) => `  "setting${index}": "value-${index}-${"x".repeat(20)}"`);
    writeFileSync(
      path.join(fixture.root, "credentials.json"),
      `{\n  "token": "old-secret-value-1234",\n${kept.join(",\n")}\n}\n`,
      "utf8",
    );
    fixture.git("add", "credentials.json");
    fixture.git("commit", "-qm", "민감 파일 커밋");
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
    fixture.git("mv", "credentials.json", "config.json");
    writeFileSync(path.join(fixture.root, "config.json"), `{\n${kept.join(",\n")}\n}\n`, "utf8");
    fixture.git("add", "config.json");
    fixture.git("commit", "-qm", "rename 뒤 secret 제거");

    // 기본 rename 감지에서는 old 경로가 목록에 없어야 이 테스트가 --no-renames 유무를 판별한다.
    const detected = execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: fixture.root, encoding: "utf8" });
    assert.doesNotMatch(detected, /credentials\.json/);
    assert.match(detected, /config\.json/);

    const scope = inspectReviewScope({ repoRoot: fixture.root, baseRef: base });
    assert.equal(scope.category, "denied-path");
  } finally {
    fixture.close();
  }
});

test("비ASCII 경로도 quote 없이 patch header에 그대로 남는다", () => {
  const fixture = repository();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fixture.root, encoding: "utf8" }).trim();
    writeFileSync(path.join(fixture.root, "검증.ts"), "export const 값 = 1;\n", "utf8");
    fixture.git("add", "검증.ts");
    fixture.git("commit", "-qm", "한글 경로 추가");

    const scope = inspectReviewScope({ repoRoot: fixture.root, baseRef: base });
    assert.equal(scope.ok, true);
    assert.match(scope.patch, /^diff --git a\/검증\.ts b\/검증\.ts$/m);
  } finally {
    fixture.close();
  }
});

test("dirty tree와 민감 경로 및 과도한 파일 수를 Codex 실행 전에 거부한다", () => {
  const fixture = repository();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.root,
      encoding: "utf8",
    }).trim();
    writeFileSync(path.join(fixture.root, "dirty.ts"), "변경\n", "utf8");
    assert.equal(
      inspectReviewScope({ repoRoot: fixture.root, baseRef: base }).category,
      "dirty-tree",
    );

    fixture.git("add", "dirty.ts");
    fixture.git("commit", "-qm", "변경 저장");
    writeFileSync(path.join(fixture.root, ".env"), "SECRET=value\n", "utf8");
    fixture.git("add", ".env");
    fixture.git("commit", "-qm", "민감 경로 추가");
    assert.equal(
      inspectReviewScope({ repoRoot: fixture.root, baseRef: base }).category,
      "denied-path",
    );
  } finally {
    fixture.close();
  }
});

test("민감 의미가 디렉터리 이름에 있어도 prompt 반입을 거부한다", () => {
  const fixture = repository();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.root,
      encoding: "utf8",
    }).trim();
    const secretDirectory = path.join(fixture.root, "config", "secrets");
    mkdirSync(secretDirectory, { recursive: true });
    writeFileSync(path.join(secretDirectory, "runtime.ts"), "export const value = true;\n", "utf8");
    fixture.git("add", "config/secrets/runtime.ts");
    fixture.git("commit", "-qm", "민감 디렉터리 추가");

    assert.equal(
      inspectReviewScope({ repoRoot: fixture.root, baseRef: base }).category,
      "denied-path",
    );
  } finally {
    fixture.close();
  }
});

test("유효하지 않은 ref와 파일·줄·patch 한도를 각각 fail-closed로 거부한다", () => {
  const fixture = repository();
  try {
    const base = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: fixture.root,
      encoding: "utf8",
    }).trim();
    writeFileSync(path.join(fixture.root, "review.ts"), "첫째 줄\n둘째 줄\n", "utf8");
    fixture.git("add", "review.ts");
    fixture.git("commit", "-qm", "검토 파일 추가");

    assert.equal(
      inspectReviewScope({ repoRoot: fixture.root, baseRef: "--help" }).category,
      "invalid-base",
    );
    assert.equal(
      inspectReviewScope({
        repoRoot: fixture.root,
        baseRef: base,
        limits: { files: 0, changedLines: 10, patchBytes: 1024 },
      }).category,
      "too-many-files",
    );
    assert.equal(
      inspectReviewScope({
        repoRoot: fixture.root,
        baseRef: base,
        limits: { files: 10, changedLines: 0, patchBytes: 1024 },
      }).category,
      "too-many-lines",
    );
    assert.equal(
      inspectReviewScope({
        repoRoot: fixture.root,
        baseRef: base,
        limits: { files: 10, changedLines: 10, patchBytes: 1 },
      }).category,
      "patch-too-large",
    );
  } finally {
    fixture.close();
  }
});
