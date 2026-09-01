import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyToolCall,
  extractIssueIdentifier,
} from "./workflow.mjs";

test("extractIssueIdentifier는 Linear 식별자를 정규화하고 일반 문장의 하이픈은 무시한다", () => {
  assert.equal(extractIssueIdentifier("eat-42 작업을 시작해줘"), "EAT-42");
  assert.equal(extractIssueIdentifier("문서만 읽어줘"), null);
  assert.equal(extractIssueIdentifier("2026-08-30 계획"), null);
});

test("extractIssueIdentifier는 pnpm 구분자를 건너뛰고 claim 인자에서 이슈를 찾는다", () => {
  assert.equal(extractIssueIdentifier(["--", "eat-11"]), "EAT-11");
  assert.equal(extractIssueIdentifier(["EAT-11"]), "EAT-11");
  assert.equal(extractIssueIdentifier(["--"]), null);
});

test("저장소 편집 도구는 차단하고 명시적인 읽기 도구만 허용한다", () => {
  assert.deepEqual(classifyToolCall("Edit", { file_path: "src/a.ts" }), {
    mutatesRepository: true,
    reason: "file-edit-tool",
  });
  assert.deepEqual(classifyToolCall("apply_patch", {}), {
    mutatesRepository: true,
    reason: "file-edit-tool",
  });
  assert.deepEqual(classifyToolCall("Read", { file_path: "src/a.ts" }), {
    mutatesRepository: false,
    reason: "known-read-only-tool",
  });
  assert.deepEqual(classifyToolCall("Bash", { command: "rg -n TODO src" }), {
    mutatesRepository: false,
    reason: "read-or-verification-command",
  });
});

test("분류되지 않은 도구와 MCP 도구는 변경 가능성이 있는 것으로 안전하게 차단한다", () => {
  for (const toolName of ["UnknownTool", "mcp__filesystem__write_file", "future_mutator"]) {
    assert.deepEqual(classifyToolCall(toolName, {}), {
      mutatesRepository: true,
      reason: "unclassified-tool-requires-claim",
    });
  }
});

test("classifyToolCall은 일반적인 PowerShell과 shell과 package와 git 변경을 인식한다", () => {
  const mutations = [
    ["Bash", { command: "git commit -m change" }],
    ["exec_command", { cmd: "Set-Content -Path a.txt -Value x" }],
    ["Bash", { command: "pnpm add zod" }],
    ["Bash", { command: "echo x > a.txt" }],
    ["Bash", { command: "rm a.txt" }],
  ];

  for (const [toolName, input] of mutations) {
    assert.equal(classifyToolCall(toolName, input).mutatesRepository, true, JSON.stringify(input));
  }
});

test("알 수 없는 shell 명령은 claim이 필요하고 좁은 읽기 허용목록만 열린다", () => {
  assert.equal(classifyToolCall("Bash", { command: "node scripts/generate.mjs" }).mutatesRepository, true);
  assert.equal(classifyToolCall("Bash", { command: "python script.py" }).mutatesRepository, true);
  assert.equal(classifyToolCall("Bash", { command: "rg -n TODO src" }).mutatesRepository, false);
  assert.equal(classifyToolCall("Bash", { command: "git status --short" }).mutatesRepository, false);
});

test("읽기 명령 prefix로 복합 명령과 pipe와 snapshot 쓰기를 숨길 수 없다", () => {
  const bypasses = [
    "rg TODO src | node scripts/write.mjs",
    "git status --short && python writer.py",
    "pnpm test -- --updateSnapshot",
    "pnpm test -u",
    "git diff`npython writer.py",
    "git diff --output=review.patch",
    "git show --ext-diff HEAD",
    "git diff --textconv HEAD",
    "rg --pre 'node tools/write-side-effect.mjs' TODO .",
  ];

  for (const command of bypasses) {
    assert.equal(
      classifyToolCall("Bash", { command }).mutatesRepository,
      true,
      command,
    );
  }
});
