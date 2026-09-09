import assert from "node:assert/strict";
import test from "node:test";

import {
  editedPathCandidate,
  extractIssueIdentifier,
  normalizeHookEvent,
  repositoryRelativePath,
  toolIsOpenToObservers,
} from "./workflow.mjs";

test("extractIssueIdentifier는 Linear 식별자를 정규화하고 일반 문장의 하이픈은 무시한다", () => {
  assert.equal(extractIssueIdentifier("codex/eat-123-auction-workspace"), "EAT-123");
  assert.equal(extractIssueIdentifier("Please implement EAT-7 now"), "EAT-7");
  assert.equal(extractIssueIdentifier("well-known text without an issue"), null);
});

test("extractIssueIdentifier는 pnpm 구분자를 건너뛰고 claim 인자에서 이슈를 찾는다", () => {
  assert.equal(extractIssueIdentifier(["--", "EAT-27"]), "EAT-27");
  assert.equal(extractIssueIdentifier(["--", "--worktree"]), null);
  assert.equal(extractIssueIdentifier(undefined), null);
});

test("holder가 아닌 세션에는 이름이 알려진 읽기·탐색·대화 도구와 Linear 조회 도구만 열린다", () => {
  for (const toolName of [
    "Read",
    "Glob",
    "Grep",
    "ToolSearch",
    "WebFetch",
    "WebSearch",
    "EnterWorktree",
    "ExitWorktree",
    "SendMessage",
    "ListAgents",
    "AskUserQuestion",
    "mcp__linear__get_issue",
    "mcp__linear__list_issues",
    "mcp__linear__search_documentation",
  ]) {
    assert.equal(toolIsOpenToObservers(toolName, {}), true, toolName);
  }
  for (const toolName of [
    "Edit",
    "Write",
    "MultiEdit",
    "NotebookEdit",
    "apply_patch",
    "Agent",
    "Task",
    "Monitor",
    "mcp__linear__save_comment",
    "mcp__linear__save_issue",
    "mcp__linear__create_issue",
    "mcp__chrome-devtools__click",
    "SomethingNew",
  ]) {
    assert.equal(toolIsOpenToObservers(toolName, {}), false, toolName);
  }
});

test("holder가 아닌 세션의 shell은 단일 workflow lifecycle 명령만 열리고 그 밖의 명령 본문은 해석하지 않는다", () => {
  for (const command of [
    "pnpm workflow:session take",
    "pnpm workflow:doctor",
    "pnpm workflow:doctor -- --worktree ../other",
    "pnpm workflow:claim -- EAT-123 --branch codex/eat-123-guard",
    "pnpm workflow:release -- EAT-122",
    "pnpm --dir F:/repo workflow:worktree prune",
    "  pnpm workflow:issues -- --state Backlog  ",
  ]) {
    assert.equal(toolIsOpenToObservers("Bash", { command }), true, command);
    assert.equal(toolIsOpenToObservers("PowerShell", { command }), true, command);
    assert.equal(toolIsOpenToObservers("exec_command", { cmd: command }), true, command);
  }
  for (const command of [
    "git status",
    "rg TODO src",
    "pnpm workflow:doctor && rm -rf .",
    "pnpm workflow:doctor | tee out.txt",
    "pnpm workflow:doctor > out.txt",
    "pnpm workflow:doctor; git push",
    "pnpm workflow:doctor $(cat x)",
    "pnpm test",
    "",
  ]) {
    assert.equal(toolIsOpenToObservers("Bash", { command }), false, command);
  }
});

test("편집 대상 경로는 provider별 키 순서 하나로 읽고 저장소 밖·제어문자·상대 탈출 경로는 기록하지 않는다", () => {
  assert.equal(editedPathCandidate({ file_path: "a", path: "b" }), "a");
  assert.equal(editedPathCandidate({ notebook_path: "n" }), "n");
  assert.equal(editedPathCandidate({}), null);

  assert.equal(repositoryRelativePath("F:/repo/src/a.ts", "F:/repo"), "src/a.ts");
  assert.equal(repositoryRelativePath("src\\a.ts", "F:/repo"), "src/a.ts");
  assert.equal(repositoryRelativePath("../outside.ts", "F:/repo"), null);
  assert.equal(repositoryRelativePath("C:/elsewhere/a.ts", "F:/repo"), null);
  assert.equal(repositoryRelativePath(`src/a${String.fromCharCode(0)}.ts`, "F:/repo"), null);
  assert.equal(repositoryRelativePath("", "F:/repo"), null);
});

test("normalizeHookEvent는 Claude와 Codex의 입력 키를 같은 모양으로 맞추고 initiated_by를 소문자로 읽는다", () => {
  assert.deepEqual(
    normalizeHookEvent({
      hook_event_name: "PreToolUse",
      initiated_by: "User",
      session_id: "s",
      tool_input: { command: "x" },
      tool_name: "Bash",
    }),
    { hookEventName: "PreToolUse", initiatedBy: "user", sessionId: "s", toolInput: { command: "x" }, toolName: "Bash" },
  );
  assert.deepEqual(normalizeHookEvent({ event: "Stop", tool: { name: "apply_patch", input: { command: "p" } } }), {
    hookEventName: "Stop",
    initiatedBy: "",
    sessionId: "default",
    toolInput: { command: "p" },
    toolName: "apply_patch",
  });
  assert.equal(normalizeHookEvent({}).hookEventName, "Unknown");
});
