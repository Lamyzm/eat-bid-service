/** @module 책임: Codex CLI의 허용 argv·환경·시간 제한과 임시 출력 수명주기를 소유한다. */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

function processError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function buildCodexArguments({ schemaPath, outputPath }) {
  return [
    "--sandbox",
    "read-only",
    "--ask-for-approval",
    "never",
    "exec",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
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

export function discoverCodex(environment) {
  if (environment.CODEX_REVIEW_BIN) return environment.CODEX_REVIEW_BIN;
  const command = process.platform === "win32" ? "where.exe" : "which";
  const name = process.platform === "win32" ? "codex.exe" : "codex";
  const result = spawnSync(command, [name], { encoding: "utf8", windowsHide: true });
  const executable =
    result.status === 0 ? result.stdout.split(/\r?\n/).find(Boolean)?.trim() : undefined;
  if (!executable)
    throw processError("EATBID_CODEX_MISSING", "Codex CLI 실행 파일을 찾을 수 없습니다.");
  return executable;
}

export function resolveCodexVersion(binary, environment) {
  const result = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    env: buildChildEnvironment(environment),
    shell: false,
    windowsHide: true,
  });
  const version = result.status === 0 ? result.stdout.trim() : "";
  if (!version)
    throw processError("EATBID_CODEX_VERSION", "Codex CLI version을 확인하지 못했습니다.");
  return version;
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
  binary,
  baseRef,
  prompt,
  schemaPath,
  timeoutMs,
  environment,
  spawnChild = spawn,
  terminateChild = terminateProcessTree,
}) {
  const temporaryDirectory = mkdtempSync(path.join(tmpdir(), "eatbid-codex-review-"));
  const outputPath = path.join(temporaryDirectory, "result.json");
  try {
    const child = spawnChild(binary, buildCodexArguments({ baseRef, schemaPath, outputPath }), {
      cwd: repoRoot,
      detached: process.platform !== "win32",
      env: buildChildEnvironment(environment),
      shell: false,
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true,
    });
    child.stderr.resume();
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

    if (exit.timeout)
      throw processError("EATBID_CODEX_TIMEOUT", "Codex 리뷰 시간이 초과되었습니다.");
    if (exit.error || exit.code !== 0) {
      throw processError("EATBID_CODEX_FAILED", "Codex 리뷰 process가 정상 종료되지 않았습니다.");
    }
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
