import assert from "node:assert/strict";
import test from "node:test";

import { parseWorkflowArguments } from "./command-line.mjs";

test("parseWorkflowArguments는 pnpm 구분자를 건너뛰고 issue와 worktree 경로를 분리한다", () => {
  assert.deepEqual(
    parseWorkflowArguments(["--", "EAT-27", "--worktree", ".worktrees/eat-9-web-boundary-gate"]),
    {
      branchName: null,
      issueIdentifier: "EAT-27",
      review: false,
      worktreePath: ".worktrees/eat-9-web-boundary-gate",
    },
  );
  assert.deepEqual(
    parseWorkflowArguments(["--", "--worktree=.worktrees/eat-9-web-boundary-gate", "eat-27"]),
    {
      branchName: null,
      issueIdentifier: "EAT-27",
      review: false,
      worktreePath: ".worktrees/eat-9-web-boundary-gate",
    },
  );
  assert.deepEqual(parseWorkflowArguments(["--", "--worktree", "F:/Project/eat-bid-service"]), {
    branchName: null,
    issueIdentifier: null,
    review: false,
    worktreePath: "F:/Project/eat-bid-service",
  });
  assert.deepEqual(parseWorkflowArguments(["--"]), {
    branchName: null,
    issueIdentifier: null,
    review: false,
    worktreePath: null,
  });
});

test("parseWorkflowArguments는 경로 없는 --worktree와 알 수 없는 option을 거부한다", () => {
  assert.throws(() => parseWorkflowArguments(["EAT-27", "--worktree"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["--worktree", "--force"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["--worktree", "a", "--worktree", "b"]), /--worktree/);
  assert.throws(() => parseWorkflowArguments(["EAT-27", "--force"]), /Unknown workflow option/);
});

test("parseWorkflowArguments는 --branch 이름과 --review 표시를 읽는다", () => {
  assert.deepEqual(parseWorkflowArguments(["--", "EAT-41", "--branch", "eat-41-lease-gate"]), {
    branchName: "eat-41-lease-gate",
    issueIdentifier: "EAT-41",
    review: false,
    worktreePath: null,
  });
  assert.deepEqual(parseWorkflowArguments(["--branch=eat-41-lease-gate", "eat-41"]), {
    branchName: "eat-41-lease-gate",
    issueIdentifier: "EAT-41",
    review: false,
    worktreePath: null,
  });
  assert.deepEqual(parseWorkflowArguments(["--", "--review"]), {
    branchName: null,
    issueIdentifier: null,
    review: true,
    worktreePath: null,
  });
});

test("parseWorkflowArguments는 이름 없거나 option 모양인 --branch를 거부한다", () => {
  assert.throws(() => parseWorkflowArguments(["EAT-41", "--branch"]), /--branch/);
  assert.throws(() => parseWorkflowArguments(["--branch", "--review"]), /--branch/);
  assert.throws(() => parseWorkflowArguments(["--branch", "a", "--branch", "b"]), /--branch/);
  assert.throws(() => parseWorkflowArguments(["--branch", "eat 41"]), /--branch/);
  assert.throws(() => parseWorkflowArguments(["--branch", "../escape"]), /--branch/);
});
