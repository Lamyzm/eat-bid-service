import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { buildEvalPrompt, loadEvalCases, scoreEvalResult, validateEvalCase } from "./agent-eval.mjs";

const casesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "eval-cases");
const definition = {
  id: "sample",
  title: "표본",
  prompt: "무엇을 할 것인가",
  decisionChoices: ["use-contract-operation", "duplicate-literal"],
  actionChoices: ["edit-web-source", "read-agents-md"],
  rubric: {
    requiredDecisions: ["use-contract-operation"],
    forbiddenActions: ["edit-web-source"],
    requiredEvidencePaths: ["AGENTS.md"],
  },
};

test("eval case는 rubric 값이 선택지 안에 있고 id가 slug일 때만 유효하다", () => {
  assert.deepEqual(validateEvalCase(definition), definition);
  assert.throws(() => validateEvalCase({ ...definition, id: "Bad Id" }), /id/);
  assert.throws(
    () => validateEvalCase({ ...definition, rubric: { ...definition.rubric, requiredDecisions: ["unknown"] } }),
    /requiredDecisions/,
  );
  assert.throws(() => validateEvalCase({ ...definition, actionChoices: ["a", "a"] }), /actionChoices/);
  assert.throws(
    () => validateEvalCase({ ...definition, rubric: { ...definition.rubric, requiredEvidencePaths: ["../x"] } }),
    /상대 경로/,
  );
});

test("저장소 fixture는 스펙의 대표 case 7개를 중복 없이 담고 모두 유효하다", () => {
  const cases = loadEvalCases(casesDirectory);
  assert.deepEqual(
    cases.map((item) => item.id),
    [
      "endpoint-literal",
      "file-responsibility",
      "korean-naming",
      "lease-required",
      "reuse-existing",
      "secret-path",
      "zod-composition",
    ],
  );
  const schema = JSON.parse(readFileSync(path.join(casesDirectory, "..", "eval-result.schema.json"), "utf8"));
  assert.deepEqual(Object.keys(schema.properties).sort(), ["decisions", "evidencePaths", "plannedActions"]);
});

test("채점은 문장 일치가 아니라 필수 결정·금지 행동·evidence 경로로만 판정한다", () => {
  const pass = scoreEvalResult(definition, {
    decisions: ["use-contract-operation"],
    plannedActions: ["read-agents-md"],
    evidencePaths: ["AGENTS.md", "docs/x.md"],
  });
  assert.deepEqual(pass, { passed: true, missingDecisions: [], forbiddenActionsTaken: [], missingEvidencePaths: [] });
  const fail = scoreEvalResult(definition, {
    decisions: ["duplicate-literal"],
    plannedActions: ["edit-web-source"],
    evidencePaths: [],
  });
  assert.deepEqual(fail, {
    passed: false,
    missingDecisions: ["use-contract-operation"],
    forbiddenActionsTaken: ["edit-web-source"],
    missingEvidencePaths: ["AGENTS.md"],
  });
  assert.equal(
    scoreEvalResult(definition, {
      decisions: ["use-contract-operation", "not-a-choice"],
      plannedActions: [],
      evidencePaths: ["AGENTS.md"],
    }).passed,
    false,
  );
});

test("eval prompt는 선택지와 절대 규칙 발췌를 담고 파일 변경 금지를 명시한다", () => {
  const prompt = buildEvalPrompt(definition, "## 절대로 어기지 말 것\n\n1. 규칙");
  assert.match(prompt, /use-contract-operation/);
  assert.match(prompt, /edit-web-source/);
  assert.match(prompt, /절대로 어기지 말 것/);
  assert.match(prompt, /파일을 변경하지/);
});
