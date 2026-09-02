import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkflowArguments } from "./command-line.mjs";

test("parseWorkflowArguments는 pnpm 구분자를 건너뛰고 issue와 worktree 경로를 분리한다", () => {
  assert.deepEqual(
    parseWorkflowArguments(["--", "EAT-27", "--worktree", ".worktrees/eat-9-web-boundary-gate"]),
    { issueIdentifier: "EAT-27", worktreePath: ".worktrees/eat-9-web-boundary-gate" },
  );
  assert.deepEqual(
    parseWorkflowArguments(["--", "--worktree=.worktrees/eat-9-web-boundary-gate", "eat-27"]),
    { issueIdentifier: "EAT-27", worktreePath: ".worktrees/eat-9-web-boundary-gate" },
  );
  assert.deepEqual(parseWorkflowArguments(["--", "--worktree", "F:/Project/eat-bid-service"]), {
    issueIdentifier: null,
    worktreePath: "F:/Project/eat-bid-service",
  });
  assert.deepEqual(parseWorkflowArguments(["--"]), { issueIdentifier: null, worktreePath: null });
});

test("parseWorkflowArguments는 경로 없는 --worktree와 알 수 없는 option을 거부한다", () => {
  assert.throws(() => parseWorkflowArguments(["EAT-27", "--worktree"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["--worktree", "--force"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["--worktree", "a", "--worktree", "b"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["EAT-27", "--force"]), /Unknown workflow option/);
});
