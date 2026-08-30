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

test("Codex 전역 훅 참고 계약은 모든 도구를 대상으로 하고 project 자동설정으로 위장하지 않는다", async () => {
  const example = await json(".codex/hooks.example.json");

  assert.equal(example.hooks.PreToolUse[0].matcher, "*");
  assert.equal(example.hooks.PostToolUse[0].matcher, "*");
  await assert.rejects(() => access(".codex/hooks.json"), { code: "ENOENT" });
});
