import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInfisicalRun,
  resolveInfisicalExecutable,
  sanitizeParentEnvironment,
} from "./infisical.mjs";

test("Infisical wrapper는 부모의 Linear key를 제거하고 다른 환경만 보존한다", () => {
  assert.deepEqual(
    sanitizeParentEnvironment({ LINEAR_API_KEY: "parent-value", PATH: "bin" }),
    { PATH: "bin" },
  );
});

test("Infisical wrapper는 승인된 tooling 경로와 shared secret 우선순위를 고정한다", () => {
  const invocation = buildInfisicalRun({
    command: "claim",
    commandArguments: ["EAT-7"],
    config: {
      infisical: {
        environment: "dev",
        path: "/tooling/linear",
        projectId: "project-id",
      },
    },
    hookPath: "hook.mjs",
    nodePath: "node",
  });

  assert.deepEqual(invocation, [
    "run",
    "--projectId=project-id",
    "--env=dev",
    "--path=/tooling/linear",
    "--secret-overriding=false",
    "--",
    "node",
    "hook.mjs",
    "claim",
    "EAT-7",
  ]);
});

test("Infisical wrapper는 --worktree 인자를 해석하지 않고 CLI에 그대로 전달한다", () => {
  const invocation = buildInfisicalRun({
    command: "claim",
    commandArguments: ["--", "EAT-27", "--worktree", ".worktrees/eat-27-agent-worktree-lease"],
    config: {
      infisical: { environment: "dev", path: "/tooling/linear", projectId: "project-id" },
    },
    hookPath: "cli.mjs",
    nodePath: "node",
  });

  assert.deepEqual(invocation.slice(-5), [
    "claim",
    "--",
    "EAT-27",
    "--worktree",
    ".worktrees/eat-27-agent-worktree-lease",
  ]);
});

test("Infisical wrapper는 claim과 sync와 doctor와 release --review 이외의 command를 거부한다", () => {
  for (const [command, commandArguments] of [
    ["release", []],
    ["release", ["--worktree", "../.."]],
    ["worktree", ["prune"]],
    ["recover-lock", []],
  ]) {
    assert.throws(
      () =>
        buildInfisicalRun({
          command,
          commandArguments,
          config: { infisical: {} },
          hookPath: "hook.mjs",
          nodePath: "node",
        }),
      /Unsupported Infisical workflow command/i,
      `${command} ${commandArguments.join(" ")}`,
    );
  }
});

test("Infisical wrapper는 Linear 상태를 옮기는 release --review만 예외로 감싼다", () => {
  const invocation = buildInfisicalRun({
    command: "release",
    commandArguments: ["--review", "--", "--worktree", "../.."],
    config: { infisical: { environment: "dev", path: "/tooling/linear", projectId: "project-id" } },
    hookPath: "cli.mjs",
    nodePath: "node",
  });

  assert.deepEqual(invocation.slice(-7), [
    "node",
    "cli.mjs",
    "release",
    "--review",
    "--",
    "--worktree",
    "../..",
  ]);
});

test("Windows npm shim 환경에서는 실제 Infisical 실행 파일을 찾아 직접 실행한다", () => {
  const expected = "C:\\npm\\node_modules\\@infisical\\cli\\bin\\infisical.exe";
  const executable = resolveInfisicalExecutable({
    environment: { PATH: "C:\\other;C:\\npm" },
    fileExists: (candidate) => candidate === expected,
    platform: "win32",
  });

  assert.equal(executable, expected);
});
