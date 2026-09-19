import assert from "node:assert/strict";
import test from "node:test";

import { chooseCompletedState, closeIssue, planIssueClose } from "./linear-close.mjs";

test("병합되지 않은 pull request는 아무것도 옮기지 않는다", () => {
  const plan = planIssueClose({ merged: false, branch: "eat-275-x", apiKeyPresent: true });
  assert.equal(plan.act, false);
});

test("issue 식별자가 없는 branch는 건너뛴다", () => {
  const plan = planIssueClose({ merged: true, branch: "chore/readme", apiKeyPresent: true });
  assert.equal(plan.act, false);
  assert.match(plan.reason, /식별자가 없습니다/u);
});

test("LINEAR_API_KEY가 없으면 식별자를 알려주고 건너뛴다", () => {
  const plan = planIssueClose({ merged: true, branch: "eat-275-x", apiKeyPresent: false });
  assert.equal(plan.act, false);
  assert.equal(plan.issue, "EAT-275");
  assert.match(plan.reason, /LINEAR_API_KEY/u);
});

test("병합된 issue branch는 옮길 대상으로 판정한다", () => {
  const plan = planIssueClose({ merged: true, branch: "eat-275-source-live-capacity", apiKeyPresent: true });
  assert.deepEqual({ act: plan.act, issue: plan.issue }, { act: true, issue: "EAT-275" });
});

test("완료 상태는 이름이 아니라 type으로 고르고 화면 순서가 앞선 것을 쓴다", () => {
  const chosen = chooseCompletedState([
    { id: "s1", name: "In Progress", type: "started", position: 1 },
    { id: "s3", name: "보관", type: "completed", position: 9 },
    { id: "s2", name: "완료", type: "completed", position: 2 },
  ]);
  assert.equal(chosen.id, "s2");
});

test("완료 상태가 하나도 없으면 고르지 않는다", () => {
  assert.equal(chooseCompletedState([{ id: "s1", name: "Todo", type: "unstarted" }]), null);
});

/** 응답 두 번(조회·변경)을 차례로 돌려주는 대역이다. 요청 본문을 모아 무엇을 보냈는지 단언한다. */
function fakeLinear(responses) {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    calls.push(JSON.parse(init.body));
    const payload = responses[calls.length - 1];
    return { ok: true, json: async () => payload };
  };
  return { calls, fetchImpl };
}

test("열려 있는 issue를 그 팀의 완료 상태로 옮긴다", async () => {
  const { calls, fetchImpl } = fakeLinear([
    {
      data: {
        issue: {
          id: "uuid-1",
          identifier: "EAT-275",
          state: { id: "s1", name: "In Progress", type: "started" },
          team: { id: "t1", states: { nodes: [{ id: "s2", name: "Done", type: "completed", position: 2 }] } },
        },
      },
    },
    { data: { issueUpdate: { success: true } } },
  ]);
  const result = await closeIssue({ apiKey: "k", identifier: "EAT-275", fetchImpl });
  assert.equal(result.moved, true);
  assert.equal(calls[1].variables.stateId, "s2");
  assert.equal(calls[1].variables.id, "uuid-1");
});

test("이미 완료인 issue는 다시 옮기지 않는다", async () => {
  const { calls, fetchImpl } = fakeLinear([
    {
      data: {
        issue: {
          id: "uuid-1",
          identifier: "EAT-1",
          state: { id: "s2", name: "Done", type: "completed" },
          team: { id: "t1", states: { nodes: [] } },
        },
      },
    },
  ]);
  const result = await closeIssue({ apiKey: "k", identifier: "EAT-1", fetchImpl });
  assert.equal(result.moved, false);
  assert.equal(calls.length, 1, "변경 요청을 보내면 안 된다");
});

test("Linear가 오류를 돌려주면 메시지만 올리고 본문은 담지 않는다", async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ errors: [{ message: "권한 없음" }] }) });
  await assert.rejects(
    () => closeIssue({ apiKey: "k", identifier: "EAT-1", fetchImpl }),
    /권한 없음/u,
  );
});
