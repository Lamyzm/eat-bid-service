import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDirectory = path.dirname(scriptPath);
const allowedCommands = new Set(["claim", "doctor", "sync"]);

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
  if (!allowedCommands.has(command)) {
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
