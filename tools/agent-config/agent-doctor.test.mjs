import assert from "node:assert/strict";
import test from "node:test";

import { inspectAgentHooks } from "./agent-doctor.mjs";

const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];
const runnerCommand = (provider) => `node "$X/tools/agent-workflow/hook.mjs" --provider ${provider}`;
const hooksJson = (provider) =>
  JSON.stringify({
    hooks: Object.fromEntries(
      EVENTS.map((event) => [event, [{ hooks: [{ type: "command", command: runnerCommand(provider) }] }]]),
    ),
  });

test("agent doctor는 project hook·Codex 참고 계약·전역 hook의 runner 연결만 보고하고 repo-local 지원은 unverified로 둔다", () => {
  const files = new Map([
    ["C:/repo/.claude/settings.json", hooksJson("claude")],
    ["C:/repo/.codex/hooks.example.json", hooksJson("codex")],
    ["C:/home/.codex/hooks.json", hooksJson("codex")],
  ]);
  const report = inspectAgentHooks({
    repoRoot: "C:/repo",
    codexHome: "C:/home/.codex",
    fileExists: (target) => files.has(target.replaceAll("\\", "/")),
    readFile: (target) => files.get(target.replaceAll("\\", "/")),
  });
  assert.equal(report.claudeProjectHook.allCallRunner, true);
  assert.equal(report.claudeProjectHook.events.length, 5);
  assert.equal(report.codexReference.allCallRunner, true);
  assert.equal(report.codexRepoLocalHookFile, false);
  assert.equal(report.codexGlobalHookReferencesRunner, true);
  assert.equal(report.codexRepoLocalHookVerified, "unverified");
});

test("agent doctor는 hook 배열이 비어 있는 event를 runner 연결로 인정하지 않는다", () => {
  const hollow = JSON.stringify({
    hooks: Object.fromEntries(EVENTS.map((event) => [event, [{ hooks: [] }]])),
  });
  const report = inspectAgentHooks({
    repoRoot: "C:/repo",
    codexHome: "C:/home/.codex",
    fileExists: () => true,
    readFile: () => hollow,
  });
  assert.equal(report.claudeProjectHook.events.length, 5);
  assert.equal(report.claudeProjectHook.allCallRunner, false);
});

test("agent doctor는 전역 hook이 없거나 runner를 부르지 않으면 false로 보고한다", () => {
  const report = inspectAgentHooks({
    repoRoot: "C:/repo",
    codexHome: "C:/home/.codex",
    fileExists: () => false,
    readFile: () => {
      throw new Error("없음");
    },
  });
  assert.equal(report.claudeProjectHook.allCallRunner, false);
  assert.equal(report.codexGlobalHookReferencesRunner, false);
});
