/** @module 책임: Claude Code CLI의 구독 OAuth 인증 doctor·무과금 child 환경·읽기 전용 argv·envelope 해석을 소유한다. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { providerError } from "../review-contract.mjs";

/**
 * allowlist 방식이라 ANTHROPIC_API_KEY·ANTHROPIC_BASE_URL·CLAUDE_CODE_OAUTH_TOKEN·Bedrock/Vertex/Foundry·
 * Infisical·Linear·DB 변수는 이름을 열거하지 않아도 전달되지 않는다. CLAUDE_CONFIG_DIR는 로컬 /login
 * credential store 위치를 바꾸는 값이라 유일하게 추가로 허용한다.
 */
const ALLOWED_ENVIRONMENT = new Set([
  "APPDATA",
  "CLAUDE_CONFIG_DIR",
  "COMSPEC",
  "HOME",
  "LANG",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "USERPROFILE",
]);
const STDOUT_LIMIT_BYTES = 4 * 1024 * 1024;
const STDERR_TAIL_BYTES = 8 * 1024;
// version·auth probe는 리뷰 예산과 별개라 CLI가 멈추면 pre-push가 무기한 기다린다. 짧게 끊는다.
const PROBE_TIMEOUT_MS = 30_000;

export function buildClaudeChildEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([key, value]) => value !== undefined && ALLOWED_ENVIRONMENT.has(key.toUpperCase()),
    ),
  );
}

function locateOnPath(name) {
  const command = process.platform === "win32" ? "where.exe" : "which";
  const result = spawnSync(command, [name], {
    encoding: "utf8",
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
  return result.status === 0 ? (result.stdout.split(/\r?\n/).find(Boolean)?.trim() ?? null) : null;
}

/** npm shim(.cmd)은 shell 없이 spawn할 수 없으므로 shim이 가리키는 native claude.exe를 직접 실행한다. */
export function resolveClaudeLaunch(
  environment,
  { platform = process.platform, locate = locateOnPath, fileExists = existsSync } = {},
) {
  if (environment.CLAUDE_REVIEW_BIN) {
    return { command: environment.CLAUDE_REVIEW_BIN, prefixArguments: [] };
  }
  const located = locate("claude");
  if (!located) {
    throw providerError("claude", "missing-cli", "Claude Code CLI 실행 파일을 찾을 수 없습니다.");
  }
  const extension = path.extname(located).toLowerCase();
  if (platform === "win32" && (extension === ".cmd" || extension === "")) {
    const native = path.win32.join(
      path.win32.dirname(located),
      "node_modules",
      "@anthropic-ai",
      "claude-code",
      "bin",
      "claude.exe",
    );
    if (!fileExists(native)) {
      throw providerError("claude", "missing-cli", "Claude npm shim 옆에서 claude.exe를 찾지 못했습니다.");
    }
    return { command: native, prefixArguments: [] };
  }
  return { command: located, prefixArguments: [] };
}

function runSyncDefault(launch, arguments_, environment) {
  return spawnSync(launch.command, [...launch.prefixArguments, ...arguments_], {
    encoding: "utf8",
    env: buildClaudeChildEnvironment(environment),
    shell: false,
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
}

function probeTimedOut(result) {
  return result?.error?.code === "ETIMEDOUT";
}

export function resolveClaudeVersion(launch, environment, { runSync = runSyncDefault } = {}) {
  const result = runSync(launch, ["--version"], environment);
  if (probeTimedOut(result)) {
    throw providerError("claude", "timeout", "Claude Code CLI version probe가 시간 제한을 넘겼습니다.");
  }
  const version = result.status === 0 ? result.stdout.trim() : "";
  if (!version) {
    throw providerError("claude", "cli-version", "Claude Code CLI version을 확인하지 못했습니다.");
  }
  return version;
}

/**
 * 구독 OAuth로 확인된 경우에만 리뷰를 시작한다. API Console·custom gateway·cloud provider 상태는
 * 과금 경로이므로 auth-unavailable로 거부한다. 요금제 정책 자체는 외부 상태라 영구 무과금을 주장하지 않는다.
 */
export function inspectClaudeAuth(launch, environment, { runSync = runSyncDefault } = {}) {
  const result = runSync(launch, ["auth", "status", "--json"], environment);
  if (probeTimedOut(result)) {
    throw providerError("claude", "timeout", "Claude Code 인증 probe가 시간 제한을 넘겼습니다.");
  }
  let status;
  try {
    status = result.status === 0 ? JSON.parse(result.stdout) : null;
  } catch {
    status = null;
  }
  const subscription = typeof status?.subscriptionType === "string" ? status.subscriptionType : "";
  if (
    status?.loggedIn !== true ||
    status.authMethod !== "claude.ai" ||
    status.apiProvider !== "firstParty" ||
    subscription.length === 0
  ) {
    throw providerError(
      "claude",
      "auth-unavailable",
      "Claude Code가 claude.ai 구독으로 로그인되어 있지 않습니다.",
    );
  }
  return { authMethod: status.authMethod, apiProvider: status.apiProvider, subscriptionType: subscription };
}

/** Claude CLI의 schema 검증기는 draft 2020-12 meta-schema를 모르므로 `$schema` 선언만 벗겨 전달한다. 다른 내용은 바꾸지 않는다. */
export function claudeSchemaArgument(schema) {
  let parsed;
  try {
    parsed = JSON.parse(schema);
  } catch {
    return schema;
  }
  if (!parsed || typeof parsed !== "object" || !("$schema" in parsed)) return schema;
  const { $schema: _declaration, ...rest } = parsed;
  return JSON.stringify(rest);
}

export function buildClaudeArguments({ schema, model }) {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    claudeSchemaArgument(schema),
    "--restricted",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--no-session-persistence",
    "--tools",
    "Read,Grep,Glob",
    "--permission-mode",
    "dontAsk",
    ...(model ? ["--model", model] : []),
  ];
}

export function parseClaudeEnvelope(stdout) {
  let messages;
  try {
    messages = JSON.parse(stdout);
  } catch {
    throw providerError("claude", "invalid-output", "Claude 출력이 JSON이 아닙니다.");
  }
  const list = Array.isArray(messages) ? messages : [messages];
  const result = [...list].reverse().find((message) => message?.type === "result");
  if (!result) throw providerError("claude", "invalid-output", "Claude result message가 없습니다.");
  const isError = result.is_error === true;
  if (!isError && (result.structured_output === undefined || result.structured_output === null)) {
    throw providerError("claude", "invalid-output", "Claude structured_output이 없습니다.");
  }
  return {
    structuredOutput: result.structured_output ?? null,
    isError,
    subtype: String(result.subtype ?? ""),
    resultText: typeof result.result === "string" ? result.result : "",
  };
}

// "rate limit reached"가 사용량 소진으로 분류되지 않도록 rate-limited를 먼저 검사한다.
const FAILURE_PATTERNS = [
  ["rate-limited", /rate limit|\b429\b/i],
  ["quota-exhausted", /usage limit|out of extra usage|quota/i],
  ["auth-unavailable", /not logged in|\/login|unauthori[sz]ed|authentication|\b401\b/i],
  ["provider-overloaded", /overloaded|\b529\b|\b503\b/i],
];

/** stderr와 result 문구는 reason 정규화 입력일 뿐이며 호출자는 원문을 저장하지 않는다. */
export function classifyClaudeFailure({ stderr = "", envelope } = {}) {
  const text = `${stderr}\n${envelope?.subtype ?? ""}\n${envelope?.resultText ?? ""}`;
  return FAILURE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? "process-failed";
}

function terminateProcessTree(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

/** prompt는 stdin으로만 보내고 즉시 닫아 사용량 소진 뒤 credit 전환 같은 대화형 입력을 자동 승인할 수 없게 한다. */
export async function executeClaudeProcess({
  repoRoot,
  launch,
  prompt,
  schema,
  model,
  timeoutMs,
  environment,
  spawnChild = spawn,
  terminateChild = terminateProcessTree,
}) {
  const child = spawnChild(
    launch.command,
    [...launch.prefixArguments, ...buildClaudeArguments({ schema, model })],
    {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: buildClaudeChildEnvironment(environment),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding?.("utf8");
  child.stderr.setEncoding?.("utf8");
  child.stdout.on("data", (chunk) => {
    if (stdout.length < STDOUT_LIMIT_BYTES) stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
  });
  child.stdin.on("error", () => undefined);
  child.stdin.end(prompt);

  const exit = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      terminateChild(child);
      resolve({ timeout: true, code: null });
    }, timeoutMs);
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ timeout: false, code: null, error });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ timeout: false, code });
    });
  });

  if (exit.timeout) throw providerError("claude", "timeout", "Claude 리뷰 시간이 초과되었습니다.");
  if (exit.error || exit.code !== 0) {
    throw providerError(
      "claude",
      classifyClaudeFailure({ code: exit.code, stderr }),
      "Claude 리뷰 process가 정상 종료되지 않았습니다.",
    );
  }
  const envelope = parseClaudeEnvelope(stdout);
  if (envelope.isError) {
    throw providerError(
      "claude",
      classifyClaudeFailure({ code: 0, stderr, envelope }),
      "Claude가 오류 result를 반환했습니다.",
    );
  }
  return envelope.structuredOutput;
}

export const claudeProvider = Object.freeze({
  name: "claude",
  resolveLaunch: resolveClaudeLaunch,
  resolveVersion: resolveClaudeVersion,
  inspectAuth: inspectClaudeAuth,
  execute: executeClaudeProcess,
});
