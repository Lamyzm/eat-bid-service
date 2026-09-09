import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("Claude 변경 전 훅은 모든 도구를 보고 변경 후 훅은 편집 도구의 경로만 기록한다", async () => {
  const settings = await json(".claude/settings.json");

  assert.equal(settings.hooks.PreToolUse[0].matcher, "*");
  assert.equal(settings.hooks.PostToolUse[0].matcher, "Edit|Write|MultiEdit|NotebookEdit");
});

const COMMON_EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];

test("Claude와 Codex hook adapter는 공통 event 모두에서 같은 runner를 자기 provider 인자로 호출하고 Claude만 SessionEnd를 더한다", async () => {
  const claude = await json(".claude/settings.json");
  const codex = await json(".codex/hooks.example.json");
  for (const [settings, provider, events] of [
    [claude, "claude", [...COMMON_EVENTS, "SessionEnd"]],
    [codex, "codex", COMMON_EVENTS],
  ]) {
    for (const event of events) {
      const commands = settings.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
      assert.equal(commands.length, 1, `${provider} ${event}`);
      assert.match(commands[0], /tools\/agent-workflow\/hook\.mjs/, `${provider} ${event}`);
      assert.match(commands[0], new RegExp(`--provider ${provider}$`), `${provider} ${event}`);
    }
    assert.deepEqual(Object.keys(settings.hooks).sort(), [...events].sort());
  }
});

test("Codex 전역 훅 참고 계약은 모든 도구를 대상으로 하고 project 자동설정으로 위장하지 않는다", async () => {
  const example = await json(".codex/hooks.example.json");

  assert.equal(example.hooks.PreToolUse[0].matcher, "*");
  assert.equal(example.hooks.PostToolUse[0].matcher, "*");
  // 사용자 전역 hook의 로컬 사본이 저장소 안에 있을 수는 있어도 추적 파일이어서는 안 된다.
  const tracked = spawnSync("git", ["ls-files", "--", ".codex/hooks.json"], { encoding: "utf8" });
  assert.equal(tracked.status, 0, tracked.stderr);
  assert.equal(tracked.stdout.trim(), "");
});
