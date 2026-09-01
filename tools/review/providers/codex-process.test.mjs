import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import test from "node:test";

import { executeCodexProcess } from "./codex-process.mjs";

function fakeChild(onInput) {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stderr = { resume: () => undefined };
  const chunks = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      onInput(Buffer.concat(chunks).toString("utf8"), child);
      callback();
    },
  });
  child.kill = () => undefined;
  return child;
}

test("Codex process는 prompt를 stdin으로만 보내고 비밀 없는 환경으로 실행한다", async () => {
  const calls = [];
  const expected = {
    schemaVersion: "eatbid.codex-review/v1",
    summary: "검토 완료",
    findings: [],
  };
  const spawnChild = (binary, arguments_, options) => {
    calls.push({ binary, arguments_, options });
    return fakeChild((prompt, child) => {
      assert.equal(prompt, "검토 prompt");
      const outputIndex = arguments_.indexOf("--output-last-message") + 1;
      writeFileSync(arguments_[outputIndex], JSON.stringify(expected), "utf8");
      queueMicrotask(() => child.emit("close", 0));
    });
  };

  const result = await executeCodexProcess({
    repoRoot: "C:/repo",
    binary: "codex",
    baseRef: "origin/main",
    prompt: "검토 prompt",
    schemaPath: "C:/schema.json",
    timeoutMs: 1000,
    environment: { PATH: "bin", CODEX_HOME: "C:/codex", DATABASE_URL: "secret" },
    spawnChild,
  });

  assert.deepEqual(result, expected);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].binary, "codex");
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.env, { PATH: "bin", CODEX_HOME: "C:/codex" });
  assert.deepEqual(calls[0].arguments_.slice(0, 8), [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
  ]);
  assert.equal(calls[0].arguments_.includes("review"), false);
  assert.equal(calls[0].arguments_.includes("--base"), false);
});

test("제한 시간을 넘긴 Codex process tree를 종료하고 typed unavailable 원인을 남긴다", async () => {
  let terminated = false;
  const child = fakeChild(() => undefined);

  await assert.rejects(
    () =>
      executeCodexProcess({
        repoRoot: "C:/repo",
        binary: "codex",
        baseRef: "origin/main",
        prompt: "검토 prompt",
        schemaPath: "C:/schema.json",
        timeoutMs: 5,
        environment: { PATH: "bin" },
        spawnChild: () => child,
        terminateChild: (target) => {
          assert.equal(target, child);
          terminated = true;
        },
      }),
    (error) => error?.code === "EATBID_CODEX_TIMEOUT",
  );
  assert.equal(terminated, true);
});
