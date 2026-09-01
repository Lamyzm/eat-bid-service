import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { inspectKoreanComments, writeKoreanCommentBaseline } from "./check-korean-comments.mjs";

function writeFiles(root, files) {
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
}

function repository(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-korean-comments-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.name", "검증 사용자");
  git("config", "user.email", "quality@example.com");
  writeFiles(root, files);
  git("add", ".");
  git("commit", "-qm", "초기 코드 저장");
  return {
    root,
    git,
    legacyCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf8",
    }).trim(),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
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
    const report = inspectKoreanComments({
      repoRoot: fixture.root,
      baselinePath: path.join(fixture.root, "baseline.json"),
      legacyCommit: fixture.legacyCommit,
    });

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
    const report = inspectKoreanComments({
      repoRoot: fixture.root,
      baselinePath: path.join(fixture.root, "baseline.json"),
      legacyCommit: fixture.legacyCommit,
    });

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
    const report = inspectKoreanComments({
      repoRoot: fixture.root,
      baselinePath: path.join(fixture.root, "baseline.json"),
      legacyCommit: fixture.legacyCommit,
    });

    assert.deepEqual(report.violations, []);
    assert.equal(report.inspectedCount, 1);
  } finally {
    fixture.close();
  }
});

test("legacy ledger는 기준 commit과 byte가 같은 부채만 허용하고 삭제는 통과시킨다", () => {
  const fixture = repository({
    "src/legacy.ts": "export const legacy = true;\n",
  });
  const baselinePath = path.join(fixture.root, "tools", "quality", "baseline.json");
  try {
    const baseline = writeKoreanCommentBaseline({
      repoRoot: fixture.root,
      baselinePath,
      legacyCommit: fixture.legacyCommit,
    });
    assert.deepEqual(
      baseline.entries.map((entry) => entry.path),
      ["src/legacy.ts"],
    );
    assert.deepEqual(
      inspectKoreanComments({
        repoRoot: fixture.root,
        baselinePath,
        legacyCommit: fixture.legacyCommit,
      }).violations,
      [],
    );

    writeFiles(fixture.root, { "src/legacy.ts": "export const legacy = false;\n" });
    assert.deepEqual(
      inspectKoreanComments({
        repoRoot: fixture.root,
        baselinePath,
        legacyCommit: fixture.legacyCommit,
      }).violations.map((item) => item.path),
      ["src/legacy.ts"],
    );

    rmSync(path.join(fixture.root, "src", "legacy.ts"));
    assert.deepEqual(
      inspectKoreanComments({
        repoRoot: fixture.root,
        baselinePath,
        legacyCommit: fixture.legacyCommit,
      }).violations,
      [],
    );
    assert.throws(
      () =>
        writeKoreanCommentBaseline({
          repoRoot: fixture.root,
          baselinePath,
          legacyCommit: fixture.legacyCommit,
        }),
      /이미 존재/,
    );
  } finally {
    fixture.close();
  }
});

test("기준 commit 뒤에 생긴 production 파일은 legacy ledger에 추가할 수 없다", () => {
  const fixture = repository({ "README.md": "초기\n" });
  const baselinePath = path.join(fixture.root, "tools", "quality", "baseline.json");
  try {
    writeFiles(fixture.root, { "src/new.ts": "export const value = true;\n" });
    const baseline = writeKoreanCommentBaseline({
      repoRoot: fixture.root,
      baselinePath,
      legacyCommit: fixture.legacyCommit,
    });
    assert.deepEqual(baseline.entries, []);
    assert.deepEqual(
      inspectKoreanComments({
        repoRoot: fixture.root,
        baselinePath,
        legacyCommit: fixture.legacyCommit,
      }).violations.map((item) => item.path),
      ["src/new.ts"],
    );
  } finally {
    fixture.close();
  }
});
