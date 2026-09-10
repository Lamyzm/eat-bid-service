import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  EXCLUDED_SCOPES,
  MAX_UPWARD_DEPTH,
  TARGET_SCOPES,
  inspectImportDepth,
  moduleSpecifiers,
  upwardDepth,
} from "./check-import-depth.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const checker = path.join(repositoryRoot, "tools", "architecture", "check-import-depth.mjs");

function createFixture(files) {
  const directory = mkdtempSync(path.join(tmpdir(), "eatbid-import-depth-"));
  for (const [relative, contents] of Object.entries(files)) {
    const file = path.join(directory, relative);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, contents);
  }
  return directory;
}

function inspect(files, changedPaths) {
  const directory = createFixture(files);
  try {
    return inspectImportDepth({
      repoRoot: directory,
      changedPaths: changedPaths ?? Object.keys(files),
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("경계값: './'와 '../'는 허용하고 '../../'부터 위반이다", () => {
  const report = inspect({
    "apps/web/src/app/one/two/same.ts": "import { a } from './neighbour';\n",
    "apps/web/src/app/one/two/parent.ts": "import { b } from '../sibling';\n",
    "apps/web/src/app/one/two/grandparent.ts": "import { c } from '../../uncle';\n",
  });

  assert.equal(MAX_UPWARD_DEPTH, 1);
  assert.equal(report.inspectedCount, 3);
  assert.deepEqual(
    report.violations.map((violation) => violation.path),
    ["apps/web/src/app/one/two/grandparent.ts"],
  );
  assert.equal(report.violations[0].depth, 2);
});

test("올라가는 단계는 실제 해석과 같게 세며 내려갔다 올라가는 경로도 맞춘다", () => {
  assert.equal(upwardDepth("./neighbour"), 0);
  assert.equal(upwardDepth("../sibling"), 1);
  assert.equal(upwardDepth("../../uncle"), 2);
  assert.equal(upwardDepth("../../../../far"), 4);
  // './a/../../b'는 실제로 한 단계만 올라간다. 문자열에 '..'가 둘 있다고 2단계로 세면 안 된다.
  assert.equal(upwardDepth("./a/../../b"), 1);
  assert.equal(upwardDepth("../a/../../b"), 2);
  // 상대 경로가 아닌 specifier는 이 규칙의 대상이 아니다.
  assert.equal(upwardDepth("@/app/one/uncle"), 0);
  assert.equal(upwardDepth("@eatbid/domain"), 0);
  assert.equal(upwardDepth("node:path"), 0);
  assert.equal(upwardDepth("..foo/bar"), 0);
});

test("import·export·동적 import·require·import type의 specifier를 모두 보고 문자열 리터럴은 보지 않는다", () => {
  const specifiers = moduleSpecifiers(
    "apps/web/src/a/b/c/sample.ts",
    [
      "import { a } from '../../one';",
      "export { b } from '../../two';",
      "export * from '../../three';",
      "const four = await import('../../four');",
      "const five = require('../../five');",
      "type Six = import('../../six').Six;",
      "const notAnImport = '../../seven';",
      "const url = new URL('../../', import.meta.url);",
    ].join("\n"),
  );

  assert.deepEqual(
    specifiers.map((item) => item.text),
    ["../../one", "../../two", "../../three", "../../four", "../../five", "../../six"],
  );
});

test("변경 범위 밖 파일과 대상이 아닌 패키지는 검사하지 않는다", () => {
  const files = {
    "apps/web/src/changed.ts": "import { a } from '../../deep';\n",
    "apps/web/src/untouched.ts": "import { b } from '../../deep';\n",
    "apps/server/src/modules/one/two/server.ts": "import { c } from '../../deep';\n",
    "packages/contracts/src/api/v1/contract.ts": "import { d } from '../../deep';\n",
    "apps/web/e2e/support/viewports.ts": "import { e } from '../../src/deep';\n",
  };
  const report = inspect(files, ["apps/web/src/changed.ts"]);

  assert.equal(report.inspectedCount, 1);
  assert.deepEqual(
    report.violations.map((violation) => violation.path),
    ["apps/web/src/changed.ts"],
  );

  // 변경 범위가 전부여도 제외한 패키지와 src 밖 경로는 여전히 대상이 아니다.
  const everything = inspect(files);
  assert.equal(everything.inspectedCount, 2);
  assert.deepEqual(
    everything.violations.map((violation) => violation.path).sort(),
    ["apps/web/src/changed.ts", "apps/web/src/untouched.ts"],
  );
});

test("위반 메시지는 한국어로 무엇을 어떻게 고치라는지 말하고 apps/web은 '@/' 별칭을 제안한다", () => {
  const report = inspect({
    "apps/web/src/app/(workspace)/auctions/[id]/_features/flow/model/series.ts":
      "import { rate } from '../../../_lib/bid-rate';\n",
    "packages/db/src/schema/app/table.ts": "import { helper } from '../../../tools/helper.js';\n",
  });

  const web = report.violations.find((violation) => violation.path.startsWith("apps/web/"));
  assert.match(web.message, /3단계를 거슬러 올라갑니다/u);
  assert.match(web.message, /'\.\.\/' 한 단계까지만 허용/u);
  assert.ok(web.message.includes("'@/app/(workspace)/auctions/[id]/_lib/bid-rate'로 바꾸십시오"), web.message);

  // 별칭이 없는 패키지에는 별칭을 제안하지 않고 구조로 안내한다.
  const db = report.violations.find((violation) => violation.path.startsWith("packages/db/"));
  assert.doesNotMatch(db.message, /@\//u);
  assert.match(db.message, /별칭이 없는 패키지이므로/u);
});

test("검사 대상 목록과 제외 목록은 겹치지 않으며 제외에는 이유와 편입 조건이 있다", () => {
  const targets = TARGET_SCOPES.map((scope) => scope.prefix);
  const excluded = EXCLUDED_SCOPES.map((scope) => scope.prefix);

  assert.deepEqual(targets, ["apps/web/src/", "packages/domain/src/", "packages/db/src/", "tools/"]);
  assert.deepEqual(excluded, ["apps/server/src/", "packages/contracts/src/"]);
  for (const prefix of excluded) assert.ok(!targets.some((target) => prefix.startsWith(target)), prefix);
  for (const scope of EXCLUDED_SCOPES) {
    assert.ok(scope.reason.length > 0, scope.prefix);
    assert.ok(scope.condition.length > 0, scope.prefix);
  }
});

test("검사기 CLI는 위반을 종료 코드 1로 알리고 제외한 경로를 함께 보고한다", () => {
  const directory = createFixture({
    "apps/web/src/clean.ts": "import { a } from '../clean';\n",
    "apps/server/src/deep/deep/server.ts": "import { b } from '../../ignored';\n",
  });
  // fixture는 git 저장소가 아니므로 파일을 열거하는 --all 대신 드라이버가 넘기는 경로 목록으로 판정한다.
  const run = (env) =>
    spawnSync(process.execPath, [checker], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: { ...process.env, IMPORT_DEPTH_ROOT: directory, ...env },
    });
  try {
    const passed = run({
      EATBID_CHANGED_PATHS: ["apps/web/src/clean.ts", "apps/server/src/deep/deep/server.ts"].join("\n"),
    });
    assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`);
    assert.match(passed.stdout, /상대 경로 import 깊이 검사가 통과했습니다/u);
    assert.match(passed.stdout, /제외 apps\/server\/src\//u);

    writeFileSync(path.join(directory, "apps", "web", "src", "clean.ts"), "import { a } from '../../deep';\n");
    const failed = run({ EATBID_CHANGED_PATHS: "apps/web/src/clean.ts" });
    assert.equal(failed.status, 1, `${failed.stdout}${failed.stderr}`);
    assert.match(failed.stderr, /상대 경로 import 깊이 검사가 실패했습니다/u);
    assert.match(failed.stderr, /apps\/web\/src\/clean\.ts:1:/u);
    assert.match(failed.stderr, /검사에서 제외한 경로/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("이 검사기 자신과 짝 테스트는 규칙을 지킨다", () => {
  // 검사기가 자기 규칙을 어기면 규칙이 실현 불가능하다는 뜻이다. 저장소 전체를 0으로 단언하지는 않는다.
  // 전체 단언은 changed-scope 모델(ADR 0042)을 테스트 안에 baseline ledger로 되살리는 것이기 때문이다.
  const report = inspectImportDepth({
    repoRoot: repositoryRoot,
    files: [
      "tools/architecture/check-import-depth.mjs",
      "tools/architecture/check-import-depth.test.mjs",
      "tools/architecture/run-checks.mjs",
    ],
  });

  assert.equal(report.inspectedCount, 3);
  assert.deepEqual(report.violations, []);
});
