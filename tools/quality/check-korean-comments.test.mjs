import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { inspectKoreanComments } from "./check-korean-comments.mjs";

const checker = fileURLToPath(new URL("./check-korean-comments.mjs", import.meta.url));

function writeFiles(root, files) {
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
}

function repository(files, { branch = "main" } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-korean-comments-"));
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-q", "-b", branch);
  git("config", "user.name", "검증 사용자");
  git("config", "user.email", "quality@example.com");
  git("config", "commit.gpgsign", "false");
  writeFiles(root, files);
  git("add", ".");
  git("commit", "-qm", "초기 코드 저장");
  return {
    root,
    git,
    write: (next) => writeFiles(root, next),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

function runChecker(root, args = []) {
  const env = { ...process.env, KOREAN_COMMENTS_ROOT: root };
  delete env.EATBID_CHANGED_PATHS;
  delete env.EATBID_CHANGED_BASE;
  const result = execFileSync(process.execPath, [checker, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return result;
}

test("TypeScript 책임 주석은 directive 다음과 import 이전의 구체적인 한국어 설명을 요구한다", () => {
  const fixture = repository({
    "src/valid.ts":
      "/** @module 책임: 공고 조회 결과를 화면 표현 값으로 변환한다. */\nimport { value } from './value';\nexport const result = value;\n",
    "src/client.tsx":
      "'use client';\n\n/** @module 책임: 사용자의 테마 선택과 화면 전환 상태를 연결한다. */\nexport function Client() { return null; }\n",
    "src/late.ts":
      "import { value } from './value';\n/** @module 책임: 늦게 작성된 설명은 허용하지 않는다. */\nexport const result = value;\n",
    "src/generic.ts": "/** @module 책임: 이 모듈을 설명한다. */\nexport const value = true;\n",
    "src/english.ts": "/** @module 책임: owns auction state */\nexport const value = true;\n",
    "src/value.ts":
      "/** @module 책임: 검증 fixture에서 공유하는 입력 값을 제공한다. */\nexport const value = true;\n",
  });
  try {
    const report = inspectKoreanComments({ repoRoot: fixture.root });

    assert.deepEqual(
      report.violations.map((item) => item.path),
      ["src/english.ts", "src/generic.ts", "src/late.ts"],
    );
  } finally {
    fixture.close();
  }
});

test("Python 책임 설명은 shebang과 encoding 다음 첫 module docstring에 둔다", () => {
  const fixture = repository({
    "src/valid.py":
      '#!/usr/bin/env python\n# -*- coding: utf-8 -*-\n"""모듈 책임: 수집 원문을 검증 가능한 정규화 입력으로 바꾼다."""\nVALUE = 1\n',
    "src/late.py":
      'from pathlib import Path\n"""모듈 책임: import 뒤의 설명은 허용하지 않는다."""\nVALUE = Path(\'.\')\n',
    "src/generic.py": '"""모듈 책임: 이 모듈을 설명한다."""\nVALUE = 1\n',
  });
  try {
    const report = inspectKoreanComments({ repoRoot: fixture.root });

    assert.deepEqual(
      report.violations.map((item) => item.path),
      ["src/generic.py", "src/late.py"],
    );
  } finally {
    fixture.close();
  }
});

test("테스트·fixture·생성물·선언형 config/schema·순수 barrel은 억지 설명 대상에서 제외한다", () => {
  const fixture = repository({
    "src/value.test.ts": "test('한국어 검증', () => {});\n",
    "src/__fixtures__/value.ts": "export const fixture = true;\n",
    "src/generated/client.ts": "export const generated = true;\n",
    "src/theme.config.ts": "export const theme = { color: 'blue' };\n",
    "src/user.schema.ts": "export const schema = { type: 'object' };\n",
    "src/index.ts": "export { value } from './value';\n",
    "src/types.d.ts": "export interface Value { id: string }\n",
    "src/value.ts":
      "/** @module 책임: 제외 규칙 fixture가 재수출할 기준 값을 제공한다. */\nexport const value = true;\n",
  });
  try {
    const report = inspectKoreanComments({ repoRoot: fixture.root });

    assert.deepEqual(report.violations, []);
    assert.equal(report.inspectedCount, 1);
  } finally {
    fixture.close();
  }
});

test("변경 범위가 주어지면 그 안의 production 모듈만 검사하고 건드리지 않은 기존 모듈은 묻지 않는다", () => {
  const fixture = repository({
    "src/legacy.ts": "export const legacy = true;\n",
    "src/other.ts": "export const other = true;\n",
  });
  try {
    fixture.write({ "src/fresh.ts": "export const fresh = true;\n" });
    const scoped = inspectKoreanComments({ repoRoot: fixture.root, changedPaths: ["src/fresh.ts"] });
    assert.deepEqual(scoped.violations.map((item) => item.path), ["src/fresh.ts"]);
    assert.equal(scoped.inspectedCount, 1);

    const touched = inspectKoreanComments({
      repoRoot: fixture.root,
      changedPaths: new Set(["src/fresh.ts", "src/legacy.ts", "src/missing.ts", "README.md"]),
    });
    assert.deepEqual(touched.violations.map((item) => item.path), ["src/fresh.ts", "src/legacy.ts"]);

    const everything = inspectKoreanComments({ repoRoot: fixture.root });
    assert.deepEqual(everything.violations.map((item) => item.path), ["src/fresh.ts", "src/legacy.ts", "src/other.ts"]);
  } finally {
    fixture.close();
  }
});

test("CLI는 main과의 merge-base 이후 신규·수정 파일만 실패로 보고한다", () => {
  const fixture = repository({
    "src/legacy.ts": "export const legacy = true;\n",
    "src/described.ts": "/** @module 책임: 기존 모듈의 책임 설명이 유지되는지 보이는 예시다. */\nexport const described = true;\n",
  });
  try {
    fixture.git("checkout", "-q", "-b", "feature");
    assert.match(runChecker(fixture.root), /통과했습니다.*HEAD 이후 작업 트리 0개 경로/u);

    fixture.write({ "src/fresh.ts": "export const fresh = true;\n" });
    assert.throws(
      () => runChecker(fixture.root),
      (error) => /src\/fresh\.ts/u.test(error.stderr) && !/src\/legacy\.ts/u.test(error.stderr),
    );

    fixture.write({ "src/fresh.ts": "/** @module 책임: 새 모듈은 처음부터 책임 설명을 가진다. */\nexport const fresh = true;\n" });
    fixture.git("add", ".");
    fixture.git("commit", "-qm", "새 모듈 추가");
    assert.match(runChecker(fixture.root), /통과했습니다.*main@[0-9a-f]{7} merge-base 이후 1개 경로, production 1개/u);

    fixture.write({ "src/legacy.ts": "export const legacy = false;\n" });
    assert.throws(() => runChecker(fixture.root), (error) => /src\/legacy\.ts/u.test(error.stderr));

    assert.throws(() => runChecker(fixture.root, ["--all"]), (error) => /src\/legacy\.ts/u.test(error.stderr));
  } finally {
    fixture.close();
  }
});

test("기준 branch를 찾지 못하면 전체를 검사하되 경고로만 알리고 명시한 base가 없으면 실패한다", () => {
  const fixture = repository({ "src/legacy.ts": "export const legacy = true;\n" }, { branch: "trunk" });
  try {
    const stdout = runChecker(fixture.root);
    assert.match(stdout, /경고로 마쳤습니다/u);

    assert.throws(() => runChecker(fixture.root, ["--base", "nope"]), (error) => /해석하지 못했습니다/u.test(error.stderr));
    assert.match(runChecker(fixture.root, ["--base", "trunk"]), /통과했습니다.*trunk@[0-9a-f]{7} merge-base 이후 0개 경로/u);
  } finally {
    fixture.close();
  }
});
