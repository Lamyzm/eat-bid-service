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

test("영문 행위에 붙인 일반적인 한국어 장식은 명세로 인정하지 않는다", () => {
  withFixture({
    "generic.test.ts": `
      import { describe, test } from "bun:test";
      describe("검증 범위를 정의한다 — request validation", () => {
        test("동작을 검증한다 — rejects an unsafe request", () => {});
        test("동작을 검증한다", () => {});
        test("한 rejects an unsafe request", () => {});
      });
    `,
    "tests/test_generic.py": `
def test_rejects_an_unsafe_request_동작을_검증한다():
    pass

def test_거부한다_an_unsafe_request():
    pass

def test_동작을_검증한다():
    pass

def test_rejects_request_거부한다():
    pass
`,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /구체적인 한국어 행위/);
    assert.match(output, /test_rejects_an_unsafe_request_동작을_검증한다/);
    assert.match(output, /test_거부한다_an_unsafe_request/);
    assert.match(output, /동작을 검증한다/);
    assert.match(output, /test_동작을_검증한다/);
    assert.match(output, /한 rejects an unsafe request/);
    assert.match(output, /test_rejects_request_거부한다/);
  });
});

test("한국어 행위 뒤 separator의 기술 식별자는 허용한다", () => {
  withFixture({
    "technical-suffix.test.ts": `
      import { test } from "node:test";
      test("요청을 거부한다 — HTTP 400", () => {});
    `,
    "tests/test_technical_suffix.py": `
def test_HTTP_400_요청을_거부한다():
    pass
`,
  }, (result) => {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});

test("JavaScript 계열 확장자를 각 문법으로 분석한다", () => {
  withFixture({
    "plain.test.js": `
      import { test as check } from "node:test";
      check("English JavaScript", () => {});
    `,
    "component.test.jsx": `
      import { test } from "node:test";
      const view = <section />;
      test("English JSX", () => void view);
    `,
    "module.test.mjs": `
      import nodeTest from "node:test";
      nodeTest("English module", () => {});
    `,
    "common.test.cjs": `
      const { test: check } = require("node:test");
      check("English CommonJS", () => {});
    `,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    for (const file of ["plain.test.js", "component.test.jsx", "module.test.mjs", "common.test.cjs"]) {
      assert.match(output, new RegExp(file.replaceAll(".", "\\.")));
    }
  });
});

test("assignment와 element access 및 require와 dynamic import 별칭을 추적한다", () => {
  withFixture({
    "aliases.test.ts": `
      import { test, it } from "bun:test";
      import * as nodeTests from "node:test";
      let assigned;
      assigned = test;
      assigned("English assignment", () => {});
      nodeTests["test"]["skip"]("English element access", () => {});
      const required = require("node:test");
      required["it"]("English require namespace", () => {});
      const { test: requiredTest } = require("node:test");
      requiredTest("English require binding", () => {});
      async function register() {
        const dynamicTests = await import("node:test");
        dynamicTests.test("English dynamic import", () => {});
      }
      let indirect;
      indirect = true ? test : it;
      const validator = { test: (_title) => true };
      let objectAssigned;
      ({ test: objectAssigned } = require("node:test"));
      objectAssigned("English object assignment", () => {});
      let nestedAssigned;
      ({ test: { skip: nestedAssigned } } = require("node:test"));
      nestedAssigned("English nested assignment", () => {});
      let conditional = test;
      if (false) conditional = validator.test;
      conditional("English conditional alias", () => {});
      let arrayAssigned;
      [arrayAssigned] = [test];
      arrayAssigned("English array assignment", () => {});
      void register;
    `,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    for (const title of [
      "English assignment",
      "English element access",
      "English require namespace",
      "English require binding",
      "English dynamic import",
      "English object assignment",
      "English nested assignment",
      "English conditional alias",
    ]) assert.match(output, new RegExp(title));
    assert.match(output, /지원하지 않는 간접 테스트 별칭/);
    assert.match(output, /\[arrayAssigned\]/);
    assert.match(output, /조건부 테스트 별칭 재할당/);
  });
});

test("rest 별칭과 callback 및 short-circuit 재할당 우회를 fail-closed로 거부한다", () => {
  withFixture({
    "rest-and-control-flow.test.ts": `
      import { test } from "node:test";
      const validator = { test: (_title) => true };
      const { ...requiredTests } = require("node:test");
      requiredTests.test("English object-rest require", () => {});
      let assignedTests;
      ({ ...assignedTests } = require("node:test"));
      assignedTests.test("English assignment-rest require", () => {});
      let callbackAlias = test;
      Promise.resolve().then(() => { callbackAlias = validator.test; });
      callbackAlias("English arrow callback assignment", () => {});
      let functionAlias = test;
      Promise.resolve().then(function register() { functionAlias = validator.test; });
      functionAlias("English callback assignment", () => {});
      let andAlias = test;
      const enabled = false;
      enabled && (andAlias = validator.test);
      andAlias("English && assignment", () => {});
      let orAlias = test;
      enabled || (orAlias = validator.test);
      orAlias("English || assignment", () => {});
      let nullishAlias = test;
      const value = undefined;
      value ?? (nullishAlias = validator.test);
      nullishAlias("English ?? assignment", () => {});
    `,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    for (const title of [
      "English object-rest require",
      "English assignment-rest require",
      "English arrow callback assignment",
      "English callback assignment",
      "English && assignment",
      "English || assignment",
      "English ?? assignment",
    ]) assert.match(output, new RegExp(title));
    assert.match(output, /조건부 테스트 별칭 재할당/);
  });
});

test("한국어 장식만 붙인 영문 행위는 명세로 인정하지 않는다", () => {
  withFixture({
    "decorated.test.ts": `
      import { test } from "node:test";
      test("한국 — English behavior", () => {});
    `,
    "tests/test_decorated.py": `
def test_emits_error_거부한다():
    pass
`,
  }, (result) => {
    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 1, output);
    assert.match(output, /한국 — English behavior/);
    assert.match(output, /test_emits_error_거부한다/);
  });
});

test("다른 symbol과 shadowing은 테스트 API로 오인하지 않는다", () => {
  withFixture({
    "shadowing.test.ts": `
      import { test as nodeTest } from "node:test";
      import { test } from "./validator";
      const validator = { test: (_title) => true };
      function helper(nodeTest) {
        nodeTest("English shadowed parameter", () => {});
      }
      {
        const nodeTest = validator.test;
        nodeTest("English shadowed block", () => {});
      }
      let assigned = nodeTest;
      assigned = validator.test;
      assigned("English overwritten alias", () => {});
      test("English non-test import", () => {});
      validator.test("English object method");
      nodeTest("실제 Node test binding은 추적한다", () => {});
      void helper;
    `,
    "validator.ts": `export const test = (_title) => true;`,
  }, (result) => {
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
  });
});
