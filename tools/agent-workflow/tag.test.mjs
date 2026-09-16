import assert from "node:assert/strict";
import test from "node:test";

import { judgeTagPreconditions, planTag } from "./tag.mjs";

test("빌드가 돌지 않고 auto-merge PR도 없으면 태그를 허용한다", () => {
  const verdict = judgeTagPreconditions({
    version: "v0.1.35",
    buildRuns: [{ databaseId: 1, status: "completed" }],
    pullRequests: [{ number: 29, headRefName: "eat-208", autoMergeRequest: null }],
  });

  assert.deepEqual(verdict, { ok: true, reasons: [] });
});

test("release 빌드가 돌고 있으면 거부한다 — 빌드 중 main이 움직이면 promote가 버린다", () => {
  const verdict = judgeTagPreconditions({ version: "v0.1.35", buildRuns: [{ databaseId: 7, status: "in_progress" }] });

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
  });

  assert.equal(verdict.ok, false);
  assert.equal(verdict.reasons.length, 1);
  assert.match(verdict.reasons[0], /#17\(eat-206-list-axes\)/u);
  assert.doesNotMatch(verdict.reasons[0], /#29/u);
});

test("버전 꼴이 틀리거나 태그가 이미 있으면 거부한다", () => {
  assert.equal(judgeTagPreconditions({ version: "0.1.35" }).ok, false);
  assert.equal(judgeTagPreconditions({ version: "release/v0.1.35" }).ok, false);
  const existing = judgeTagPreconditions({ version: "v0.1.35", existingTag: true });
  assert.equal(existing.ok, false);
  assert.match(existing.reasons[0], /이미 있습니다/u);
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
