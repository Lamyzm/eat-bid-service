import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(repositoryRoot, "tools", "quality", "check-test-names.mjs");

function fixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-test-name-check-"));
  for (const [relativePath, source] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, source, "utf8");
  }
  return root;
}

function run(root) {
  return spawnSync(process.execPath, [checker], {
    cwd: repositoryRoot,
    env: { ...process.env, TEST_NAMES_ROOT: root },
    encoding: "utf8",
  });
}

function withFixture(files, assertion) {
  const root = fixture(files);
  try {
    assertion(run(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("직접 호출과 별칭 및 each 계열의 한국어 명세를 허용한다", () => {
  withFixture({
    "suite.test.ts": `
      import { describe as suite, it, test as check } from "bun:test";
      const focused = check.only;
      const skipped = it.skip;
      const table = check.each([[1]]);
      suite("품질 검사기", () => {
        focused("직접 별칭을 검사한다", () => {});
        skipped("skip 별칭도 검사한다", () => {});
        check.todo("미구현 명세도 한국어로 남긴다");
        table("each 행 %s를 검사한다", () => {});
        suite.each([[1]])("describe.each 행 %s를 묶는다", () => {});
      });
    `,
  }, (result) => {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

test("영문 제목과 동적 제목 및 간접 별칭을 fail-closed로 거부한다", () => {
  withFixture({
    "violations.test.ts": `
      import { describe, it, test } from "bun:test";
      const alias = test;
      const indirect = true ? test : it;
      const title = "동적 제목";
      describe("English suite", () => {});
      alias.skip("English alias", () => {});
      test.each([[1]])("English each %s", () => {});
      it(title, () => {});
      indirect("간접 선언", () => {});
    `,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /한글 음절/);
    assert.match(output, /동적 테스트 제목/);
    assert.match(output, /지원하지 않는 간접 테스트 별칭/);
  });
});

test("fixture 문자열 안의 가짜 테스트 호출은 AST 선언으로 오인하지 않는다", () => {
  withFixture({
    "checker.test.ts": `
      import { test } from "bun:test";
      const adversarialFixture = 'test("English fixture", () => {})';
      test("문자열 fixture를 무시한다", () => {
        void adversarialFixture;
      });
    `,
  }, (result) => {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

test("정규식과 객체의 test 메서드는 테스트 API 별칭으로 오인하지 않는다", () => {
  withFixture({
    "production.ts": `
      const fileName = "domain.test.ts";
      const isProduction = !/\\.(?:test|spec)\\.tsx?$/.test(fileName);
      const accepted = validator.test(fileName);
      void isProduction;
      void accepted;
    `,
  }, (result) => {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

test("Python pytest 함수명은 한국어를 요구하고 async 선언도 검사한다", () => {
  withFixture({
    "tests/test_valid.py": `
def test_유효한_경로를_허용한다():
    pass

async def test_async_경로도_허용한다():
    pass
`,
    "tests/test_invalid.py": `
def test_rejects_english_only_name():
    pass
`,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /tests\/test_invalid\.py/);
    assert.match(output, /test_rejects_english_only_name/);
  });
});
