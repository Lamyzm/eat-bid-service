/** @module 책임: Linear secret이 필요한 workflow command만 Infisical run으로 감싸 실행하고 부모 환경의 key 상속을 끊는다. */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
// issue 발행은 저장소 파일을 하나도 바꾸지 않지만 Linear API key 없이는 불가능하다. 이 wrapper가
// 유일한 key 주입 경로이므로 여기에 없으면 agent는 issue를 만들 때마다 사람에게 부탁해야 한다.
const allowedCommands = new Set(["claim", "doctor", "issue", "sync"]);

// release는 기본적으로 오프라인 명령이라 secret 주입 경로를 열지 않는다. Linear 상태를 실제로 옮기는
// `release --review`만 예외이며, 이 wrapper가 없으면 `--review`는 key를 얻을 방법이 없다.
function commandIsAllowed(command, commandArguments) {
  if (allowedCommands.has(command)) return true;
  return command === "release" && commandArguments.includes("--review");
}

export function sanitizeParentEnvironment(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name.toUpperCase() !== "LINEAR_API_KEY"),
  );
}

export function resolveInfisicalExecutable({
  environment = process.env,
  fileExists = existsSync,
  platform = process.platform,
} = {}) {
  if (environment.INFISICAL_EXECUTABLE) return environment.INFISICAL_EXECUTABLE;
  if (platform !== "win32") return "infisical";

  const searchPath = environment.PATH ?? environment.Path ?? "";
  for (const directory of searchPath.split(";").filter(Boolean)) {
    const candidates = [
      path.win32.join(directory, "infisical.exe"),
      path.win32.join(directory, "node_modules", "@infisical", "cli", "bin", "infisical.exe"),
    ];
    const executable = candidates.find((candidate) => fileExists(candidate));
    if (executable) return executable;
  }
  throw new Error("Infisical executable was not found on PATH");
}

export function buildInfisicalRun({ command, commandArguments, config, hookPath, nodePath }) {
  if (!commandIsAllowed(command, commandArguments)) {
    throw new Error(`Unsupported Infisical workflow command: ${command ?? "missing"}`);
  }
  const infisical = config?.infisical;
  for (const field of ["projectId", "environment", "path"]) {
    if (typeof infisical?.[field] !== "string" || infisical[field].length === 0) {
      throw new Error(`Missing Infisical workflow config: ${field}`);
    }
  }
  return [
    "run",
    `--projectId=${infisical.projectId}`,
    `--env=${infisical.environment}`,
    `--path=${infisical.path}`,
    "--secret-overriding=false",
    "--",
    nodePath,
    hookPath,
    command,
    ...commandArguments,
  ];
}

function main() {
  const config = JSON.parse(readFileSync(path.join(scriptDirectory, "config.json"), "utf8"));
  const command = process.argv[2];
  const args = buildInfisicalRun({
    command,
    commandArguments: process.argv.slice(3),
    config,
    hookPath: path.join(scriptDirectory, "cli.mjs"),
    nodePath: process.execPath,
  });
  const environment = sanitizeParentEnvironment(process.env);
  const result = spawnSync(resolveInfisicalExecutable({ environment }), args, {
    env: environment,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Infisical workflow launch failed: ${error?.message ?? String(error)}\n`);
    process.exitCode = 1;
  }
}
