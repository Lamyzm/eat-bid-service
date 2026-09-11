import assert from "node:assert/strict";
import test from "node:test";

import { planPullRequest } from "./pull-request.mjs";

const claim = { issueIdentifier: "EAT-194" };

test("issue branch는 push·생성·자동 병합 셋을 순서대로 계획한다", () => {
  const plan = planPullRequest({
    branch: "eat-194-main-protection",
    claim,
    issueUrl: "https://linear.app/eatbid/issue/EAT-194",
    subject: "fix: 무언가를 고친다 (EAT-194)",
  });

  assert.equal(plan.ok, true);
  assert.equal(plan.issue, "EAT-194");
  assert.deepEqual(plan.steps.map((step) => step.label), ["push", "create", "auto-merge"]);
  assert.deepEqual(plan.steps[0].args, [
    "push",
    "--set-upstream",
    "origin",
    "eat-194-main-protection",
  ]);
  assert.equal(plan.steps[2].args.includes("--auto"), true);
});

test("본문은 Linear 연결과 병합 판정자를 말한다", () => {
  const plan = planPullRequest({
    branch: "eat-194-main-protection",
    claim,
    issueUrl: "https://linear.app/eatbid/issue/EAT-194",
    subject: "제목",
  });

  const body = plan.steps[1].args.at(-1);
  assert.match(body, /linear\.app/u);
  assert.match(body, /변경 검증/u);
});

test("main에서는 pull request를 열지 않는다", () => {
  const plan = planPullRequest({ branch: "main", claim, subject: "제목" });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /issue branch/u);
});

test("claim이 branch와 어긋나면 원격에 닿기 전에 멈춘다", () => {
  const plan = planPullRequest({
    branch: "eat-194-main-protection",
    claim: { issueIdentifier: "EAT-193" },
    subject: "제목",
  });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /EAT-193/u);
});

test("식별자가 없는 통합 branch는 거절한다", () => {
  const plan = planPullRequest({ branch: "integration", claim, subject: "제목" });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /issue 식별자/u);
});

test("커밋이 없으면 push하지 않는다", () => {
  const plan = planPullRequest({ branch: "eat-194-main-protection", claim, subject: null });

  assert.equal(plan.ok, false);
  assert.match(plan.message, /커밋/u);
});
