import assert from "node:assert/strict";
import test from "node:test";

import { issueFromBranch, planPullRequest } from "./pull-request.mjs";

test("issue branch는 push·생성·자동 병합 셋을 순서대로 계획한다", () => {
  const plan = planPullRequest({ branch: "chore/216-remove-linear", subject: "chore: Linear를 걷는다 (#216)" });

  assert.equal(plan.ok, true);
  assert.deepEqual(plan.issue, { kind: "github", number: 216 });
  assert.deepEqual(plan.steps.map((step) => step.label), ["push", "create", "auto-merge"]);
  assert.deepEqual(plan.steps[0].args, ["push", "--set-upstream", "origin", "chore/216-remove-linear"]);
  assert.equal(plan.steps[2].args.includes("--auto"), true);
});

test("본문은 병합 때 issue를 닫는 Closes 줄과 병합 판정자를 말한다", () => {
  const plan = planPullRequest({ branch: "fix/42-floor-rate", subject: "제목" });

  const body = plan.steps[1].args.at(-1);
  assert.match(body, /^Closes #42$/mu);
  assert.match(body, /변경 검증/u);
});

test("Linear 시절 eat-N 가지는 열되 GitHub issue를 닫지 않고 기록으로만 남긴다", () => {
  const plan = planPullRequest({ branch: "eat-369-seat-assignment", subject: "제목" });

  assert.equal(plan.ok, true);
  const body = plan.steps[1].args.at(-1);
  assert.match(body, /Linear 기록: EAT-369/u);
  assert.doesNotMatch(body, /Closes/u);
});

test("main에서는 pull request를 열지 않는다", () => {
  const plan = planPullRequest({ branch: "main", subject: "제목" });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /issue branch/u);
});

test("issue 번호가 없는 가지는 원격에 닿기 전에 모양을 알려 주고 멈춘다", () => {
  for (const branch of ["integration", "chore/remove-linear", "216-remove-linear", "chore/216"]) {
    const plan = planPullRequest({ branch, subject: "제목" });
    assert.equal(plan.ok, false, branch);
    assert.match(plan.message, /<type>\/<issue 번호>-<slug>/u);
  }
});

test("커밋이 없으면 push하지 않는다", () => {
  const plan = planPullRequest({ branch: "chore/216-remove-linear", subject: null });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /커밋/u);
});

test("가지 이름 해석은 GitHub 번호를 먼저 보고 둘 다 없으면 모른다고 답한다", () => {
  assert.deepEqual(issueFromBranch("feat/7-a"), { kind: "github", number: 7 });
  assert.deepEqual(issueFromBranch("EAT-12-legacy"), { kind: "linear", identifier: "EAT-12" });
  assert.equal(issueFromBranch(""), null);
  assert.equal(issueFromBranch(undefined), null);
});
