import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface DevelopmentSmokeOptions {
  readonly timeoutMs: number;
}

export interface DevelopmentSmokeResult {
  readonly compiler: "tsc";
  readonly nestExecutableFound: boolean;
  readonly initialBootObserved: boolean;
  readonly recompilationObserved: boolean;
  readonly restartObserved: boolean;
}

const bootMarker = '"event":"application_ready"';
const mutationMarker = "eatbid development smoke mutation";
const toolsDirectory = dirname(fileURLToPath(import.meta.url));

function sanitizedPath(): string {
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((entry) => {
      if (!entry) return false;
      return !["nest", "nest.cmd", "nest.exe"].some((name) => existsSync(join(entry, name)));
    })
    .join(delimiter);
}

function terminateTree(pid: number): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // The child may already have exited after a smoke failure.
    }
  }
}

async function removeSmokeDirectory(smokeRoot: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(smokeRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw lastError;
}

export async function runDevelopmentSmoke(
  options: DevelopmentSmokeOptions,
): Promise<DevelopmentSmokeResult> {
  const serverRoot = resolve(toolsDirectory, "..");
  const smokeRoot = mkdtempSync(join(tmpdir(), "eatbid-server-dev-smoke-"));
  const path = sanitizedPath();
  const pathProbe = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["nest"], {
    env: { ...process.env, PATH: path },
    windowsHide: true,
  });
  const nestExecutableFound = pathProbe.status === 0
    || existsSync(join(serverRoot, "node_modules/.bin/nest"))
    || existsSync(join(serverRoot, "node_modules/.bin/nest.cmd"));
  if (nestExecutableFound) throw new Error("Development smoke requires PATH without a Nest CLI executable");

  try {
    cpSync(join(serverRoot, "src"), join(smokeRoot, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
      copyFileSync(join(serverRoot, file), join(smokeRoot, file));
    }
    symlinkSync(join(serverRoot, "node_modules"), join(smokeRoot, "node_modules"), "junction");

    const child = spawn("pnpm", ["run", "dev"], {
      cwd: smokeRoot,
      env: {
        ...process.env,
        PATH: path,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        NODE_ENV: "test",
        PORT: "0",
      },
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let bootCount = 0;
    let mutationObserved = false;
    let mutationWritten = false;

    const observe = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      output += text;
      bootCount = output.split(bootMarker).length - 1;
      mutationObserved = output.includes(mutationMarker);
      if (bootCount >= 1 && !mutationWritten) {
        mutationWritten = true;
        appendFileSync(
          join(smokeRoot, "src/main.ts"),
          `\nconsole.log(${JSON.stringify(mutationMarker)});\n`,
          "utf8",
        );
      }
    };
    child.stdout.on("data", observe);
    child.stderr.on("data", observe);

    try {
      await new Promise<void>((resolvePromise, reject) => {
        let poll: NodeJS.Timeout;
        const timeout = setTimeout(() => {
          clearInterval(poll);
          reject(new Error(`Development smoke timed out after ${options.timeoutMs}ms.\n${output}`));
        }, options.timeoutMs);
        poll = setInterval(() => {
          if (bootCount >= 2 && mutationObserved) {
            clearInterval(poll);
            clearTimeout(timeout);
            resolvePromise();
          }
        }, 50);
        child.once("exit", (code) => {
          if (bootCount >= 2 && mutationObserved) return;
          clearInterval(poll);
          clearTimeout(timeout);
          reject(new Error(`Development command exited with ${code}.\n${output}`));
        });
        child.once("error", (error) => {
          clearInterval(poll);
          clearTimeout(timeout);
          reject(error);
        });
      });
    } finally {
      if (child.pid) terminateTree(child.pid);
    }

    return {
      compiler: "tsc",
      nestExecutableFound,
      initialBootObserved: bootCount >= 1,
      recompilationObserved: mutationObserved,
      restartObserved: bootCount >= 2,
    };
  } finally {
    const expectedPrefix = resolve(tmpdir(), "eatbid-server-dev-smoke-").toLowerCase();
    if (!resolve(smokeRoot).toLowerCase().startsWith(expectedPrefix)) {
      throw new Error(`Refusing to remove unexpected smoke directory: ${smokeRoot}`);
    }
    await removeSmokeDirectory(smokeRoot);
  }
}

if (import.meta.main) {
  const result = await runDevelopmentSmoke({ timeoutMs: 30_000 });
  console.log(JSON.stringify(result));
}
