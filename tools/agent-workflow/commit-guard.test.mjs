import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBranchClaim, localBranchesFromPushStdin, verifyClaimOnline } from "./commit-guard.mjs";

test("issue branch의 커밋은 같은 issue의 claim이 있는 worktree에서만 통과한다", () => {
  const claim = { issueIdentifier: "EAT-123", assigneeId: "viewer" };

  assert.equal(evaluateBranchClaim({ branch: "codex/eat-123-guard", claim }).ok, true);
  assert.equal(evaluateBranchClaim({ branch: "codex/eat-123-guard", claim }).reason, "claim-matches");

  const missing = evaluateBranchClaim({ branch: "codex/eat-123-guard", claim: null });
  assert.equal(missing.ok, false);
  assert.equal(missing.reason, "claim-missing");
  assert.match(missing.message, /pnpm workflow:claim -- EAT-123/);

  const mismatch = evaluateBranchClaim({ branch: "codex/eat-124-next", claim });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, "claim-mismatch");
  assert.match(mismatch.message, /branch는 EAT-124, 이 worktree의 claim은 EAT-123/);
});

test("issue 식별자가 없는 통합 branch는 claim 없이도 검사하지 않는다", () => {
  for (const branch of ["main", "dev", "", "release/hotfix"]) {
    assert.deepEqual(evaluateBranchClaim({ branch, claim: null }), { ok: true, issue: null, reason: "integration-branch" });
  }
});

test("pre-push stdin에서는 local branch ref만 읽고 tag와 삭제는 무시한다", () => {
  const stdin = [
    "refs/heads/codex/eat-123-guard abc refs/heads/codex/eat-123-guard def",
    "refs/tags/release/v0.1.9 abc refs/tags/release/v0.1.9 000",
    "(delete) 000 refs/heads/old abc",
    "refs/heads/main abc refs/heads/main def",
    "",
  ].join("\n");

  assert.deepEqual(localBranchesFromPushStdin(stdin), ["codex/eat-123-guard", "main"]);
});

test("online 재검증은 assignee가 바뀐 claim만 실패시키고 상태를 바꾸지 않는다", async () => {
  const calls = [];
  const client = {
    async verifyIssueOwnership(identifier, config) {
      calls.push([identifier, config.teamKey]);
      return { assigneeId: "viewer", assigneeName: "Owner", issueIdentifier: identifier, stateName: "In Progress" };
    },
  };
  const config = { teamKey: "EAT", terminalStates: ["Done"] };

  const same = await verifyClaimOnline({ claim: { issueIdentifier: "EAT-1", assigneeId: "viewer" }, client, config });
  assert.equal(same.ok, true);
  assert.match(same.message, /In Progress/);

  const changed = await verifyClaimOnline({ claim: { issueIdentifier: "EAT-1", assigneeId: "someone" }, client, config });
  assert.equal(changed.ok, false);
  assert.match(changed.message, /assignee/);
  assert.deepEqual(calls, [["EAT-1", "EAT"], ["EAT-1", "EAT"]]);
});
