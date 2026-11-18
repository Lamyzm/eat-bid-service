import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectWebCopy } from "./web-copy/inspect.mjs";
import { COPY_BASELINE_PATH, COPY_RULES, forbiddenWord, isQuestion } from "./web-copy/policy.mjs";

const cli = fileURLToPath(new URL("./check-web-copy.mjs", import.meta.url));

function tree(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-web-copy-"));
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents, "utf8");
  }
  return root;
}

test("금지 말 사전은 띄어쓰기가 달라도 낱말을 찾고 쓰는 말은 통과시킨다", () => {
  assert.equal(forbiddenWord("지난 1,184회차 중"), "회차");
  assert.equal(forbiddenWord("아침갱신 값"), "아침갱신");
  assert.equal(forbiddenWord("11월 값을 넣으세요."), undefined);
  assert.equal(forbiddenWord("하한 88% 공고"), undefined);
});

test("한글 문장 뒤의 물음표만 질문형으로 보고 주소의 물음표는 보지 않는다", () => {
  assert.equal(isQuestion("이 사업장을 뺄까요?"), true);
  assert.equal(isQuestion("어느 구간에 모였나요 ?"), true);
  assert.equal(isQuestion("/work?month=11"), false);
  assert.equal(isQuestion("사업장을 뺐어요."), false);
});

test("화면 글만 보고 주석·import·시험 파일은 보지 않는다", () => {
  const root = tree({
    "apps/web/src/app/a.tsx": "// 회차는 우리 말이다\nexport const A = () => <p>지난 회차 결과</p>;\n",
    "apps/web/src/app/b.tsx": "export const B = () => <p title='값을 넣을까요?'>값</p>;\n",
    "apps/web/src/app/c.test.tsx": "export const C = () => <p>회차</p>;\n",
    "apps/web/src/app/d.tsx": "/* 사정률 */\nexport const D = () => <p>11월 값</p>;\n",
  });
  try {
    const report = inspectWebCopy({ repoRoot: root, sourceRoot: "apps/web/src" });
    assert.deepEqual(report.findings.map((item) => `${item.rule} ${item.path}`).sort(), [
      `${COPY_RULES.FORBIDDEN_WORD} apps/web/src/app/a.tsx`,
      `${COPY_RULES.QUESTION} apps/web/src/app/b.tsx`,
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("목록에 있는 옛 위반은 통과시키고, 새 위반과 사라진 열쇠는 실패로 보고하며 정리 명령은 지우기만 한다", () => {
  const root = tree({
    "apps/web/src/app/old.tsx": "export const A = () => <p>표본 120건</p>;\n",
    "apps/web/src/app/new.tsx": "export const B = () => <p>맞춤 금액</p>;\n",
    [COPY_BASELINE_PATH]: JSON.stringify({ [COPY_RULES.FORBIDDEN_WORD]: ["apps/web/src/app/old.tsx", "apps/web/src/app/gone.tsx"], [COPY_RULES.QUESTION]: [] }),
  });
  try {
    const run = () => spawnSync(process.execPath, [cli], { env: { ...process.env, WEB_COPY_ROOT: root }, encoding: "utf8" });
    const failed = run();
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /new\.tsx:1 \[copy-forbidden-word\] "맞춤"/u);
    assert.match(failed.stderr, /gone\.tsx'는 더 이상 위반이 아닙니다/u);
    assert.doesNotMatch(failed.stderr, /old\.tsx/u);

    rmSync(path.join(root, "apps/web/src/app/new.tsx"));
    const pruned = spawnSync(process.execPath, [cli, "--prune-baseline"], { env: { ...process.env, WEB_COPY_ROOT: root }, encoding: "utf8" });
    assert.equal(pruned.status, 0, pruned.stderr);
    const written = JSON.parse(readFileSync(path.join(root, COPY_BASELINE_PATH), "utf8"));
    assert.deepEqual(written[COPY_RULES.FORBIDDEN_WORD], ["apps/web/src/app/old.tsx"]);
    assert.equal(run().status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
