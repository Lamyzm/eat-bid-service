import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inspectDecisionVocabulary } from "./decision-vocabulary/inspect.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const cli = path.join(repositoryRoot, "tools", "architecture", "check-decision-vocabulary.mjs");

function inspect(files) {
  const root = mkdtempSync(path.join(tmpdir(), "eatbid-decision-vocabulary-"));
  try {
    for (const [relativePath, contents] of Object.entries(files)) {
      const target = path.join(root, relativePath);
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, contents, "utf8");
    }
    return { root, report: inspectDecisionVocabulary({ repoRoot: root, sourceRoots: ["apps/web/src"] }) };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test("문자열·template·JSX 텍스트의 반사실 주어와 기대낙찰을 잡고 주석·시험·fixture는 보지 않는다", () => {
  const { root, report } = inspect({
    "apps/web/src/a.tsx": [
      "// 주석의 기대낙찰은 왜 금지인지 설명하는 자리라 통과한다.",
      "export const won = { text: '낙찰값 이하였을 회차', sub: '지금 값을 그때 냈다면' };",
      "export function Head({ rate }: { rate: string }) { return <th>{rate} 썼다면</th>; }",
      "export const label = `지난 ${3}회 중 이 값이면 4회 낙찰`;",
      "export const bubble = '기대낙찰(연 공고 ÷ 업체)';",
    ].join("\n"),
    "apps/web/src/a.test.tsx": "export const bad = '90.000 썼다면';",
    "apps/web/src/__fixtures__/copy.ts": "export const bad = '기대낙찰';",
  });
  try {
    assert.deepEqual(
      report.findings.map((item) => [item.path, item.line, item.rule, item.phrase]),
      [
        ["apps/web/src/a.tsx", 2, "counterfactual-subject", "였을 회차"],
        ["apps/web/src/a.tsx", 2, "counterfactual-subject", "냈다면"],
        ["apps/web/src/a.tsx", 3, "counterfactual-subject", "썼다면"],
        ["apps/web/src/a.tsx", 4, "counterfactual-award-count", "이 값이면 4회 낙찰"],
        ["apps/web/src/a.tsx", 5, "expected-award", "기대낙찰"],
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("과거 회차가 주어인 서술과 홀로 선 이 값이면 제목은 통과한다", () => {
  const { root, report } = inspect({
    "apps/web/src/ok.tsx": [
      "export const won = { text: '낙찰값이 이 값 이상이었던 회차', sub: '투찰률 축끼리 견줌' };",
      "export const floor = '그날 하한이 이 값보다 높았던 회차';",
      "export function Title() { return <span>이 값이면</span>; }",
      "export const head = `${'90.000'} 기준`;",
      "export const warn = '이 눈금은 사정률입니다. NeaT에 넣는 투찰률과 분모가 다릅니다.';",
    ].join("\n"),
  });
  try {
    assert.deepEqual(report.findings, []);
    assert.equal(report.fileCount, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("CLI는 finding이 있으면 exit 1이고 없으면 살펴본 파일 수를 말한다", () => {
  const failing = inspect({ "apps/web/src/bad.ts": "export const bad = '추천값 90.030';" });
  try {
    assert.throws(() => execFileSync(process.execPath, [cli], { env: { ...process.env, DECISION_VOCABULARY_ROOT: failing.root }, stdio: "pipe" }));
  } finally {
    rmSync(failing.root, { recursive: true, force: true });
  }
  const passing = inspect({ "apps/web/src/good.ts": "export const good = '낙찰값 위';" });
  try {
    const output = execFileSync(process.execPath, [cli], { env: { ...process.env, DECISION_VOCABULARY_ROOT: passing.root }, encoding: "utf8" });
    assert.match(output, /통과했습니다\. 살펴본 파일 1개/u);
  } finally {
    rmSync(passing.root, { recursive: true, force: true });
  }
});
