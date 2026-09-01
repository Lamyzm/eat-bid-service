import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { writeFileSync } from "node:fs";
import { Writable } from "node:stream";
import test from "node:test";

import {
  buildChildEnvironment,
  buildCodexArguments,
  classifyCodexFailure,
  executeCodexProcess,
  resolveCodexLaunch,
} from "./codex-process.mjs";

const launch = { command: "codex", prefixArguments: [] };

function fakeChild(onInput) {
  const child = new EventEmitter();
  child.pid = 1234;
  child.stderr = Object.assign(new EventEmitter(), {
    resume: () => undefined,
    setEncoding: () => undefined,
  });
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

test("Codex를 custom prompt와 호환되는 read-only ephemeral exec argv로만 실행한다", () => {
  assert.deepEqual(
    buildCodexArguments({ schemaPath: "C:/tmp/schema.json", outputPath: "C:/tmp/result.json" }),
    [
      "--sandbox",
      "read-only",
      "--ask-for-approval",
      "never",
      "exec",
      "--ephemeral",
      "--ignore-user-config",
      "--ignore-rules",
      "--output-schema",
      "C:/tmp/schema.json",
      "--json",
      "--output-last-message",
      "C:/tmp/result.json",
      "-",
    ],
  );
});

test("요청 model이 있으면 Codex exec에 --model로 전달하고 없으면 CLI 기본값을 쓴다", () => {
  const withModel = buildCodexArguments({ schemaPath: "s.json", outputPath: "o.json", model: "gpt-test" });
  const modelIndex = withModel.indexOf("--model");
  assert.ok(modelIndex > withModel.indexOf("exec"));
  assert.equal(withModel[modelIndex + 1], "gpt-test");
  assert.equal(buildCodexArguments({ schemaPath: "s.json", outputPath: "o.json" }).includes("--model"), false);
});

test("child 환경은 실행과 인증에 필요한 값만 허용하고 secret을 제거한다", () => {
  const child = buildChildEnvironment({
    PATH: "bin",
    SystemRoot: "C:/Windows",
    USERPROFILE: "C:/Users/test",
    CODEX_HOME: "C:/Users/test/.codex",
    DATABASE_URL: "secret",
    INFISICAL_TOKEN: "secret",
    LINEAR_API_KEY: "secret",
  });

  assert.deepEqual(child, {
    PATH: "bin",
    SystemRoot: "C:/Windows",
    USERPROFILE: "C:/Users/test",
    CODEX_HOME: "C:/Users/test/.codex",
  });
});

test("Windows npm shim은 node와 codex.js로 해석하고 native exe는 그대로 실행한다", () => {
  const shim = resolveCodexLaunch(
    {},
    {
      platform: "win32",
      locate: () => "C:\\Users\\kano\\AppData\\Roaming\\npm\\codex.cmd",
      fileExists: (candidate) => candidate.endsWith("codex.js"),
      nodePath: "C:\\node.exe",
    },
  );
  assert.deepEqual(shim, {
    command: "C:\\node.exe",
    prefixArguments: [
      "C:\\Users\\kano\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js",
    ],
  });

  const native = resolveCodexLaunch(
    {},
    { platform: "win32", locate: () => "C:\\bin\\codex.exe", fileExists: () => true },
  );
  assert.deepEqual(native, { command: "C:\\bin\\codex.exe", prefixArguments: [] });

  const override = resolveCodexLaunch(
    { CODEX_REVIEW_BIN: "/opt/codex" },
    { platform: "linux", locate: () => null },
  );
  assert.deepEqual(override, { command: "/opt/codex", prefixArguments: [] });
});

test("Codex 실행 파일을 찾지 못하면 missing-cli reason의 provider 오류를 던진다", () => {
  assert.throws(
    () => resolveCodexLaunch({}, { platform: "linux", locate: () => null }),
    (error) => error?.code === "EATBID_PROVIDER_ERROR" && error.reason === "missing-cli",
  );
});

test("Codex stderr 문구를 안정된 fallback reason으로 정규화하고 알 수 없는 실패는 process-failed다", () => {
  assert.equal(classifyCodexFailure({ code: 1, stderr: "You've hit your usage limit" }), "quota-exhausted");
  assert.equal(classifyCodexFailure({ code: 1, stderr: "429 Too Many Requests: rate limit" }), "rate-limited");
  assert.equal(classifyCodexFailure({ code: 1, stderr: "401 Unauthorized. Run codex login" }), "auth-unavailable");
  assert.equal(classifyCodexFailure({ code: 1, stderr: "503 Service overloaded" }), "provider-overloaded");
  assert.equal(classifyCodexFailure({ code: 1, stderr: "sandbox: failed to spawn tool" }), "tool-failed");
  assert.equal(classifyCodexFailure({ code: 1, stderr: "무언가 다른 오류" }), "process-failed");
});

test("Codex process는 prompt를 stdin으로만 보내고 비밀 없는 환경으로 실행한다", async () => {
  const calls = [];
  const expected = { schemaVersion: "eatbid.ai-review/v2", summary: "검토 완료", findings: [] };
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
    launch,
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

test("구조화 출력 파일이 JSON이 아니면 invalid-output reason으로 실패한다", async () => {
  await assert.rejects(
    () =>
      executeCodexProcess({
        repoRoot: "C:/repo",
        launch,
        prompt: "검토 prompt",
        schemaPath: "C:/schema.json",
        timeoutMs: 1000,
        environment: { PATH: "bin" },
        spawnChild: (_binary, arguments_) =>
          fakeChild((_prompt, child) => {
            const outputIndex = arguments_.indexOf("--output-last-message") + 1;
            writeFileSync(arguments_[outputIndex], "not json", "utf8");
            queueMicrotask(() => child.emit("close", 0));
          }),
      }),
    (error) => error?.code === "EATBID_PROVIDER_ERROR" && error.reason === "invalid-output",
  );
});

test("비정상 종료의 stderr는 reason 정규화에만 쓰고 오류 메시지에 원문을 넣지 않는다", async () => {
  await assert.rejects(
    () =>
      executeCodexProcess({
        repoRoot: "C:/repo",
        launch,
        prompt: "검토 prompt",
        schemaPath: "C:/schema.json",
        timeoutMs: 1000,
        environment: { PATH: "bin" },
        spawnChild: () =>
          fakeChild((_prompt, child) => {
            child.stderr.emit("data", "You've hit your usage limit: 비밀 토큰 abc");
            queueMicrotask(() => child.emit("close", 1));
          }),
      }),
    (error) =>
      error?.reason === "quota-exhausted" && !String(error.message).includes("비밀 토큰"),
  );
});

test("제한 시간을 넘긴 Codex process tree를 종료하고 timeout reason을 남긴다", async () => {
  let terminated = false;
  const child = fakeChild(() => undefined);

  await assert.rejects(
    () =>
      executeCodexProcess({
        repoRoot: "C:/repo",
        launch,
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
    (error) => error?.code === "EATBID_PROVIDER_ERROR" && error.reason === "timeout",
  );
  assert.equal(terminated, true);
});
