/** @module 책임: Codex CLI의 실행 파일 해석·허용 argv·환경·시간 제한과 오류 reason 정규화를 소유한다. */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { providerError } from "../review-contract.mjs";

const ALLOWED_ENVIRONMENT = new Set([
  "APPDATA",
  "CODEX_HOME",
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
const STDERR_TAIL_BYTES = 8 * 1024;
// version·발견 probe는 리뷰 예산과 별개라 CLI가 멈추면 pre-push가 무기한 기다린다. 짧게 끊는다.
const PROBE_TIMEOUT_MS = 30_000;

export function buildCodexArguments({ schemaPath, outputPath, model }) {
  return [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    ...(model ? ["--model", model] : []),
    "--output-schema",
    schemaPath,
    "--json",
    "--output-last-message",
    outputPath,
    "-",
  ];
}

export function buildChildEnvironment(environment) {
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

/**
 * npm shim(.cmd)은 Node가 shell 없이 spawn할 수 없고 shell:true는 schema·prompt 인수 주입 위험이 있다.
 * 그래서 shim 옆의 실제 codex.js를 node로 직접 실행하고 native exe는 그대로 쓴다.
 */
export function resolveCodexLaunch(
  environment,
  {
    platform = process.platform,
    locate = locateOnPath,
    fileExists = existsSync,
    nodePath = process.execPath,
  } = {},
) {
  if (environment.CODEX_REVIEW_BIN) {
    return { command: environment.CODEX_REVIEW_BIN, prefixArguments: [] };
  }
  const located = locate("codex");
  if (!located) throw providerError("codex", "missing-cli", "Codex CLI 실행 파일을 찾을 수 없습니다.");
  const extension = path.extname(located).toLowerCase();
  if (platform === "win32" && (extension === ".cmd" || extension === "")) {
    const script = path.win32.join(
      path.win32.dirname(located),
      "node_modules",
      "@openai",
      "codex",
      "bin",
      "codex.js",
    );
    if (!fileExists(script)) {
      throw providerError("codex", "missing-cli", "Codex npm shim 옆에서 codex.js를 찾지 못했습니다.");
    }
    return { command: nodePath, prefixArguments: [script] };
  }
  return { command: located, prefixArguments: [] };
}

function runSyncDefault(launch, arguments_, environment) {
  return spawnSync(launch.command, [...launch.prefixArguments, ...arguments_], {
    encoding: "utf8",
    env: buildChildEnvironment(environment),
    shell: false,
    timeout: PROBE_TIMEOUT_MS,
    windowsHide: true,
  });
}

export function resolveCodexVersion(launch, environment, { runSync = runSyncDefault } = {}) {
  const result = runSync(launch, ["--version"], environment);
  if (result?.error?.code === "ETIMEDOUT") {
    throw providerError("codex", "timeout", "Codex CLI version probe가 시간 제한을 넘겼습니다.");
  }
  const version = result.status === 0 ? result.stdout.trim() : "";
  if (!version) {
    throw providerError("codex", "cli-version", "Codex CLI version을 확인하지 못했습니다.");
  }
  return version;
}

const FAILURE_PATTERNS = [
  ["quota-exhausted", /usage limit|quota|exceeded your/i],
  ["rate-limited", /rate limit|\b429\b/i],
  ["auth-unavailable", /unauthori[sz]ed|not logged in|codex login|\b401\b/i],
  ["provider-overloaded", /overloaded|\b503\b|\b502\b/i],
  ["tool-failed", /sandbox|failed to spawn tool/i],
];

/** stderr 원문은 분기 권위가 아니라 정규화 입력일 뿐이며 호출자는 원문을 저장하지 않는다. */
export function classifyCodexFailure({ stderr = "" }) {
  return FAILURE_PATTERNS.find(([, pattern]) => pattern.test(stderr))?.[0] ?? "process-failed";
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

/** prompt를 stdin으로만 보내고 제한 시간 안의 마지막 구조화 메시지만 읽는다. */
export async function executeCodexProcess({
  repoRoot,
  launch,
  prompt,
  schemaPath,
  model,
  timeoutMs,
  environment,
  spawnChild = spawn,
  terminateChild = terminateProcessTree,
}) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "eatbid-ai-review-codex-"));
  const outputPath = path.join(temporaryDirectory, "result.json");
  try {
    const child = spawnChild(
      launch.command,
      [...launch.prefixArguments, ...buildCodexArguments({ schemaPath, outputPath, model })],
      {
        cwd: repoRoot,
        detached: process.platform !== "win32",
        env: buildChildEnvironment(environment),
        shell: false,
        stdio: ["pipe", "ignore", "pipe"],
        windowsHide: true,
      },
    );
    let stderr = "";
    child.stderr.setEncoding?.("utf8");
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_BYTES);
    });
    child.stderr.resume?.();
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

    if (exit.timeout) throw providerError("codex", "timeout", "Codex 리뷰 시간이 초과되었습니다.");
    if (exit.error || exit.code !== 0) {
      throw providerError(
        "codex",
        classifyCodexFailure({ code: exit.code, stderr }),
        "Codex 리뷰 process가 정상 종료되지 않았습니다.",
      );
    }
    try {
      return JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      throw providerError("codex", "invalid-output", "Codex 구조화 출력을 읽지 못했습니다.");
    }
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

export const codexProvider = Object.freeze({
  name: "codex",
  resolveLaunch: resolveCodexLaunch,
  resolveVersion: resolveCodexVersion,
  execute: executeCodexProcess,
});
