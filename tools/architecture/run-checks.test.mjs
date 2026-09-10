import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { CHECKS, parseArguments, runChecks, selectChecks } from "./run-checks.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const driver = path.join(repositoryRoot, "tools", "architecture", "run-checks.mjs");

function runDriver(args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv };
  delete env.EATBID_CHANGED_PATHS;
  delete env.EATBID_CHANGED_BASE;
  return spawnSync(process.execPath, [driver, ...args], { cwd: repositoryRoot, encoding: "utf8", env });
}

test("검사 목록의 id는 유일하고 각 검사는 worker script나 child command 중 하나만 가진다", () => {
  const ids = CHECKS.map((check) => check.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const check of CHECKS) {
    assert.ok(Boolean(check.script) !== Boolean(check.command), check.id);
    assert.ok(check.scope.length > 0, check.id);
    assert.ok(check.weight >= 1, check.id);
  }
});

test("인자 해석은 pnpm이 넘기는 리터럴 --를 무시하고 알 수 없는 옵션은 거부한다", () => {
  assert.deepEqual(parseArguments(["--", "--changed", "--base", "origin/main"]), {
    changed: true,
    list: false,
    base: "origin/main",
    only: undefined,
    jobs: undefined,
  });
  assert.deepEqual([...parseArguments(["--only", "test-names,korean-comments"]).only], ["test-names", "korean-comments"]);
  assert.equal(parseArguments(["--jobs", "2"]).jobs, 2);
  assert.throws(() => parseArguments(["--write-baseline"]), /알 수 없는 옵션/u);
  assert.throws(() => parseArguments(["--jobs", "0"]), /--jobs/u);
  // 값이 빠진 --base는 자동 기준 탐색으로 강등되지 않고 실패한다.
  assert.throws(() => parseArguments(["--changed", "--base"]), /--base 옵션에는 값이 필요/u);
  assert.throws(() => parseArguments(["--base", "--changed"]), /--base 옵션에는 값이 필요/u);
  assert.throws(() => parseArguments(["--only"]), /--only 옵션에는 값이 필요/u);
});

test("변경 경로는 scope가 닿는 검사만 고르고 검사 도구가 바뀌면 전부 고른다", () => {
  const ids = (selection) => selection.selected.map((check) => check.id).sort();

  assert.deepEqual(ids(selectChecks({ changedPaths: ["docs/architecture/stack/README.md"] })), ["stack-docs"]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["apps/web/src/shell/nav.tsx"] })), [
    "contract-client-exports",
    "http-operations",
    "korean-comments",
    "region-vocabulary",
    "semantic-values",
    "web-boundaries",
  ]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["apps/dataplane/src/eatbid/cli.py"] })), [
    "contracts-python-models",
    "korean-comments",
    "python-semantic-values",
    "write-map",
  ]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["packages/db/drizzle/20260908180418_x/snapshot.json"] })), ["db-erd"]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["docs/architecture/ingestion-write-map.md"] })), ["write-map"]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["apps/server/src/app.test.ts"] })), [
    "http-operations",
    "korean-comments",
    "region-vocabulary",
    "semantic-values",
    "test-names",
  ]);
  // 서버 모듈 경계 검사는 모듈 안 변경에만 붙는다. platform·bootstrap 변경은 그 검사를 고르지 않는다.
  assert.deepEqual(ids(selectChecks({ changedPaths: ["apps/server/src/modules/procurement/application/find-auction.ts"] })), [
    "http-operations",
    "korean-comments",
    "region-vocabulary",
    "semantic-values",
    "server-boundaries",
  ]);
  assert.deepEqual(ids(selectChecks({ changedPaths: ["README.md", "docs/adr/0042.md"] })), []);

  const tooling = selectChecks({ changedPaths: ["tools/quality/check-korean-comments.mjs"] });
  assert.equal(tooling.reason, "tooling");
  assert.equal(tooling.selected.length, CHECKS.length);
  assert.equal(selectChecks({ changedPaths: ["package.json"] }).reason, "tooling");
});

test("병렬 실행은 무거운 검사부터 시작하고 각 검사의 출력과 종료 코드를 따로 모은다", async () => {
  const order = [];
  const fast = { id: "fast", label: "빠른 검사", script: "tools/architecture/check-stack-docs.mjs", weight: 1, scope: [] };
  const broken = { id: "broken", label: "실패하는 검사", command: `${JSON.stringify(process.execPath)} -e "console.error('경계 위반'); process.exitCode = 3"`, weight: 5, scope: [] };
  const results = await runChecks({
    checks: [fast, broken],
    env: { ...process.env },
    jobs: 2,
    onResult: (result) => order.push(result.check.id),
  });

  const byId = new Map(results.map((result) => [result.check.id, result]));
  assert.equal(byId.get("fast").status, 0);
  assert.match(byId.get("fast").output, /passed/u);
  assert.equal(byId.get("broken").status, 3);
  assert.match(byId.get("broken").output, /경계 위반/u);
  assert.deepEqual(order.sort(), ["broken", "fast"]);
});

test("드라이버 CLI는 --list로 목록을 보이고 --only로 고른 검사의 실패를 종료 코드로 전한다", () => {
  const listed = runDriver(["--list"]);
  assert.equal(listed.status, 0, listed.stderr);
  for (const check of CHECKS) assert.match(listed.stdout, new RegExp(`^${check.id}\\b`, "mu"));

  const passed = runDriver(["--only", "stack-docs,web-runtime"]);
  assert.equal(passed.status, 0, `${passed.stdout}${passed.stderr}`);
  assert.match(passed.stdout, /architecture gate 통과: 통과 2개, 실패 0개/u);

  const emptyRoot = mkdtempSync(path.join(tmpdir(), "eatbid-run-checks-"));
  try {
    const failed = runDriver(["--only", "web-runtime"], { WEB_RUNTIME_ROOT: emptyRoot });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /실패 web-runtime/u);
    assert.match(failed.stdout, /architecture gate 실패: 통과 0개, 실패 1개/u);
  } finally {
    rmSync(emptyRoot, { recursive: true, force: true });
  }

  const unknown = runDriver(["--only", "nope"]);
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /알 수 없는 검사 id/u);
});
