import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import test from "node:test";

import {
  buildClaudeArguments,
  buildClaudeChildEnvironment,
  classifyClaudeFailure,
  executeClaudeProcess,
  inspectClaudeAuth,
  parseClaudeEnvelope,
  resolveClaudeLaunch,
} from "./claude-process.mjs";

const SCHEMA = '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}';
const launch = { command: "claude", prefixArguments: [] };

function fakeChild({ stdout = "", stderr = "", code = 0, onInput = () => undefined }) {
  const child = new EventEmitter();
  child.pid = 4321;
  child.stdout = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  child.stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  const chunks = [];
  child.stdin = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
    final(callback) {
      onInput(Buffer.concat(chunks).toString("utf8"));
      queueMicrotask(() => {
        if (stdout) child.stdout.emit("data", stdout);
        if (stderr) child.stderr.emit("data", stderr);
        child.emit("close", code);
      });
      callback();
    },
  });
  child.kill = () => undefined;
  return child;
}

function resultEnvelope(extra) {
  return JSON.stringify([
    { type: "system", subtype: "init", model: "claude-opus-5" },
    { type: "result", subtype: "success", is_error: false, structured_output: { ok: true }, ...extra },
  ]);
}

test("Claude child 환경은 과금·API·cloud provider·secret 변수를 모두 제거하고 OAuth store 경로만 남긴다", () => {
  const child = buildClaudeChildEnvironment({
    PATH: "bin",
    USERPROFILE: "C:/Users/test",
    CLAUDE_CONFIG_DIR: "C:/Users/test/.claude",
    ANTHROPIC_API_KEY: "sk-secret",
    ANTHROPIC_AUTH_TOKEN: "secret",
    ANTHROPIC_BASE_URL: "https://gateway.example",
    CLAUDE_CODE_OAUTH_TOKEN: "secret",
    CLAUDE_CODE_USE_BEDROCK: "1",
    CLAUDE_CODE_USE_VERTEX: "1",
    CLAUDE_CODE_USE_FOUNDRY: "1",
    AWS_ACCESS_KEY_ID: "secret",
    GOOGLE_APPLICATION_CREDENTIALS: "secret",
    INFISICAL_TOKEN: "secret",
    LINEAR_API_KEY: "secret",
    DATABASE_URL: "secret",
  });
  assert.deepEqual(child, {
    PATH: "bin",
    USERPROFILE: "C:/Users/test",
    CLAUDE_CONFIG_DIR: "C:/Users/test/.claude",
  });
});

test("claude.ai 구독 로그인만 허용하고 API key·cloud provider·미로그인 상태는 auth-unavailable로 거부한다", () => {
  const ok = inspectClaudeAuth(launch, {}, {
    runSync: () => ({
      status: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "claude.ai",
        apiProvider: "firstParty",
        subscriptionType: "max",
      }),
    }),
  });
  assert.deepEqual(ok, { authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "max" });

  const rejected = [
    { loggedIn: false },
    { loggedIn: true, authMethod: "console", apiProvider: "firstParty", subscriptionType: "" },
    { loggedIn: true, authMethod: "claude.ai", apiProvider: "bedrock", subscriptionType: "max" },
    { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", subscriptionType: "" },
    { loggedIn: true, authMethod: "apiKey", apiProvider: "firstParty", subscriptionType: "max" },
  ];
  for (const status of rejected) {
    assert.throws(
      () =>
        inspectClaudeAuth(launch, {}, {
          runSync: () => ({ status: 0, stdout: JSON.stringify(status) }),
        }),
      (error) => error?.code === "EATBID_PROVIDER_ERROR" && error.reason === "auth-unavailable",
      JSON.stringify(status),
    );
  }
  assert.throws(
    () => inspectClaudeAuth(launch, {}, { runSync: () => ({ status: 1, stdout: "" }) }),
    (error) => error?.reason === "auth-unavailable",
  );
});

test("Claude argv는 non-interactive 읽기 전용 restricted 실행과 JSON schema 구조화 출력만 사용한다", () => {
  assert.deepEqual(buildClaudeArguments({ schema: SCHEMA }), [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    SCHEMA,
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--tools",
    "Read,Grep,Glob",
    "--permission-mode",
    "dontAsk",
  ]);
  assert.deepEqual(buildClaudeArguments({ schema: SCHEMA, model: "opus" }).slice(-2), ["--model", "opus"]);
  for (const forbidden of ["--bare", "--dangerously-skip-permissions", "--console", "--api-key"]) {
    assert.equal(buildClaudeArguments({ schema: SCHEMA }).includes(forbidden), false, forbidden);
  }
});

test("Windows npm shim은 옆의 native claude.exe로 해석하고 없으면 missing-cli다", () => {
  const shim = resolveClaudeLaunch(
    {},
    {
      platform: "win32",
      locate: () => "C:\\Users\\kano\\AppData\\Roaming\\npm\\claude.cmd",
      fileExists: (candidate) => candidate.endsWith("claude.exe"),
    },
  );
  assert.deepEqual(shim, {
    command:
      "C:\\Users\\kano\\AppData\\Roaming\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe",
    prefixArguments: [],
  });
  assert.deepEqual(
    resolveClaudeLaunch({ CLAUDE_REVIEW_BIN: "/opt/claude" }, { platform: "linux", locate: () => null }),
    { command: "/opt/claude", prefixArguments: [] },
  );
  assert.throws(
    () => resolveClaudeLaunch({}, { platform: "linux", locate: () => null }),
    (error) => error?.reason === "missing-cli",
  );
});

test("Claude process는 prompt를 stdin으로만 보내고 stdin을 닫은 뒤 result의 structured_output만 돌려준다", async () => {
  const calls = [];
  let receivedPrompt = "";
  const result = await executeClaudeProcess({
    repoRoot: "C:/repo",
    launch,
    prompt: "검토 prompt",
    schema: SCHEMA,
    timeoutMs: 1000,
    environment: { PATH: "bin", ANTHROPIC_API_KEY: "sk-secret" },
    spawnChild: (command, arguments_, options) => {
      calls.push({ command, arguments_, options });
      return fakeChild({
        stdout: resultEnvelope(),
        onInput: (prompt) => {
          receivedPrompt = prompt;
        },
      });
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(receivedPrompt, "검토 prompt");
  assert.equal(calls[0].options.shell, false);
  assert.deepEqual(calls[0].options.env, { PATH: "bin" });
  assert.equal(calls[0].arguments_.includes("검토 prompt"), false);
  assert.equal(calls[0].options.stdio[0], "pipe");
});

test("Claude envelope의 오류·사용량 소진·구조화 출력 누락을 allowlist reason으로 정규화한다", () => {
  assert.equal(classifyClaudeFailure({ code: 1, stderr: "You've reached your usage limit" }), "quota-exhausted");
  assert.equal(classifyClaudeFailure({ code: 1, stderr: "429 rate limit" }), "rate-limited");
  assert.equal(classifyClaudeFailure({ code: 1, stderr: "Not logged in. Please run /login" }), "auth-unavailable");
  assert.equal(classifyClaudeFailure({ code: 1, stderr: "529 overloaded_error" }), "provider-overloaded");
  assert.equal(
    classifyClaudeFailure({ code: 0, envelope: { isError: true, subtype: "error_max_turns" } }),
    "process-failed",
  );
  assert.equal(classifyClaudeFailure({ code: 1, stderr: "" }), "process-failed");
  assert.deepEqual(parseClaudeEnvelope(resultEnvelope()), {
    structuredOutput: { ok: true },
    isError: false,
    subtype: "success",
    resultText: "",
  });
  assert.throws(() => parseClaudeEnvelope("not json"), (error) => error?.reason === "invalid-output");
  assert.throws(
    () => parseClaudeEnvelope(JSON.stringify([{ type: "result", subtype: "success", is_error: false }])),
    (error) => error?.reason === "invalid-output",
  );
});

test("오류 result envelope는 사용량 문구에 따라 reason을 정하고 structured_output을 돌려주지 않는다", async () => {
  await assert.rejects(
    () =>
      executeClaudeProcess({
        repoRoot: "C:/repo",
        launch,
        prompt: "검토 prompt",
        schema: SCHEMA,
        timeoutMs: 1000,
        environment: { PATH: "bin" },
        spawnChild: () =>
          fakeChild({
            stdout: JSON.stringify([
              { type: "result", subtype: "error_during_execution", is_error: true, result: "usage limit reached" },
            ]),
          }),
      }),
    (error) => error?.code === "EATBID_PROVIDER_ERROR" && error.reason === "quota-exhausted",
  );
});

test("제한 시간을 넘긴 Claude process tree를 종료하고 timeout reason을 남긴다", async () => {
  let terminated = false;
  const child = fakeChild({});
  child.stdin = new Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
    final(callback) {
      callback();
    },
  });
  await assert.rejects(
    () =>
      executeClaudeProcess({
        repoRoot: "C:/repo",
        launch,
        prompt: "검토 prompt",
        schema: SCHEMA,
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
