import assert from "node:assert/strict";
import test from "node:test";

import { composeTagMessage, judgeTagPreconditions, planTag } from "./tag.mjs";

const GREEN_MAIN = { databaseId: 100, status: "completed", conclusion: "success" };

test("빌드가 돌지 않고 auto-merge PR도 없고 main 회차가 초록이면 태그를 허용한다", () => {
  const verdict = judgeTagPreconditions({
    version: "v0.1.35",
    buildRuns: [{ databaseId: 1, status: "completed" }],
    pullRequests: [{ number: 29, headRefName: "eat-208", autoMergeRequest: null }],
    mainValidation: GREEN_MAIN,
  });

  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

test("release 빌드가 돌고 있으면 거부한다 — 빌드 중 main이 움직이면 promote가 버린다", () => {
  const verdict = judgeTagPreconditions({
    version: "v0.1.35",
    buildRuns: [{ databaseId: 7, status: "in_progress" }],
    mainValidation: GREEN_MAIN,
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.reasons[0], /#7\(in_progress\)/u);
});

test("auto-merge가 켜진 PR이 열려 있으면 번호와 브랜치를 보이며 거부한다", () => {
  const verdict = judgeTagPreconditions({
    version: "v0.1.35",
    pullRequests: [
      { number: 17, headRefName: "eat-206-list-axes", autoMergeRequest: { enabledAt: "2026-09-15" } },
      { number: 29, headRefName: "eat-208", autoMergeRequest: null },
    ],
    mainValidation: GREEN_MAIN,
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 1);
  assert.match(verdict.reasons[0], /#17\(eat-206-list-axes\)/u);
  assert.doesNotMatch(verdict.reasons[0], /#29/u);
});

test("버전 꼴이 틀리거나 태그가 이미 있으면 거부한다", () => {
  assert.equal(judgeTagPreconditions({ version: "0.1.35", mainValidation: GREEN_MAIN }).ok, false);
  assert.equal(judgeTagPreconditions({ version: "release/v0.1.35", mainValidation: GREEN_MAIN }).ok, false);
  const existing = judgeTagPreconditions({ version: "v0.1.35", existingTag: true, mainValidation: GREEN_MAIN });
  assert.equal(existing.ok, false);
  assert.match(existing.reasons[0], /이미 있습니다/u);
});

test("main HEAD의 validate 회차가 실패·미완료·없음이면 거부한다 — v0.1.36은 빨간 main 2분 뒤에 태그됐다", () => {
  const red = judgeTagPreconditions({
    version: "v0.1.37",
    mainValidation: { databaseId: 35045806415, status: "completed", conclusion: "failure" },
  });
  assert.equal(red.ok, false);
  assert.match(red.reasons[0], /#35045806415\(completed\/failure\)/u);
  assert.match(red.reasons[0], /--hotfix/u);

  const running = judgeTagPreconditions({
    version: "v0.1.37",
    mainValidation: { databaseId: 5, status: "in_progress", conclusion: null },
  });
  assert.equal(running.ok, false);
  assert.match(running.reasons[0], /#5\(in_progress\/-\)/u);

  const missing = judgeTagPreconditions({ version: "v0.1.37" });
  assert.equal(missing.ok, false);
  assert.match(missing.reasons[0], /회차 없음/u);
});

test("hotfix 사유가 있으면 빨간 main에서도 통과한다 — 장애를 고치는 배포까지 막으면 안 된다", () => {
  const verdict = judgeTagPreconditions({
    version: "v0.1.37",
    mainValidation: { databaseId: 1, status: "completed", conclusion: "failure" },
    hotfixReason: "poll-open 격리 회귀 복구",
  });

  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

test("hotfix 사유는 사람이 준 메시지가 있어도 태그 메시지에 남는다", () => {
  const sha = "abcdef0123456789".padEnd(40, "0");

  assert.equal(
    composeTagMessage({ version: "v0.1.37", sha, subject: "Merge pull request #51" }),
    "release v0.1.37\n\nmain abcdef01: Merge pull request #51",
  );
  assert.equal(
    composeTagMessage({ version: "v0.1.37", sha, subject: "s", message: "직접 쓴 메시지", hotfixReason: "복구" }),
    "직접 쓴 메시지\n\nhotfix: 복구",
  );
});

test("계획은 annotated tag 객체와 그 객체를 가리키는 ref 둘이다", () => {
  const plan = planTag({ version: "v0.1.35", sha: "a".repeat(40), message: "release v0.1.35", tagger: { name: "kano", email: "k@example.com" } });

  assert.equal(plan.tag, "release/v0.1.35");
  assert.deepEqual(plan.object, {
    tag: "release/v0.1.35",
    message: "release v0.1.35",
    object: "a".repeat(40),
    type: "commit",
    tagger: { name: "kano", email: "k@example.com" },
  });
  assert.deepEqual(plan.ref("b".repeat(40)), { ref: "refs/tags/release/v0.1.35", sha: "b".repeat(40) });
});
