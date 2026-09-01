import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

test("Claude 변경 전후 훅은 PowerShell과 새 도구를 포함해 모든 도구에 적용된다", async () => {
  const settings = await json(".claude/settings.json");

  assert.equal(settings.hooks.PreToolUse[0].matcher, "*");
  assert.equal(settings.hooks.PostToolUse[0].matcher, "*");
});

const EVENTS = ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse", "Stop"];

test("Claude와 Codex hook adapter는 다섯 event 모두에서 같은 공통 runner를 자기 provider 인자로 호출한다", async () => {
  const claude = await json(".claude/settings.json");
  const codex = await json(".codex/hooks.example.json");
  for (const event of EVENTS) {
    for (const [settings, provider] of [
      [claude, "claude"],
      [codex, "codex"],
    ]) {
      const commands = settings.hooks[event].flatMap((group) => group.hooks.map((hook) => hook.command));
      assert.equal(commands.length, 1, `${provider} ${event}`);
      assert.match(commands[0], /tools\/agent-workflow\/hook\.mjs/, `${provider} ${event}`);
      assert.match(commands[0], new RegExp(`--provider ${provider}$`), `${provider} ${event}`);
    }
  }
  assert.deepEqual(Object.keys(claude.hooks).sort(), [...EVENTS].sort());
  assert.deepEqual(Object.keys(codex.hooks).sort(), [...EVENTS].sort());
});

test("Codex 전역 훅 참고 계약은 모든 도구를 대상으로 하고 project 자동설정으로 위장하지 않는다", async () => {
  const example = await json(".codex/hooks.example.json");

  assert.equal(example.hooks.PreToolUse[0].matcher, "*");
  assert.equal(example.hooks.PostToolUse[0].matcher, "*");
  await assert.rejects(() => access(".codex/hooks.json"), { code: "ENOENT" });
});
