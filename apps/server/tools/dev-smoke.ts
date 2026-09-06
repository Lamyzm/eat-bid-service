/**
 * @module 책임: Nest CLI가 없는 PATH에서 `pnpm dev`가 compile→기동→재compile→재시작까지 실제로
 * 도는지 임시 사본에서 돌려 확인하고, 각 단계의 소요 시간과 마지막 출력으로 어느 단계가 왜 멈췄는지
 * 지목하며, 테스트 러너의 타임아웃보다 먼저 스스로 끝나 자식 프로세스와 임시 디렉터리를 남기지 않는다.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DevelopmentSmokeStageName =
  | "초기 compile"
  | "초기 기동"
  | "재compile"
  | "재시작";

export interface DevelopmentSmokeStage {
  readonly name: DevelopmentSmokeStageName;
  readonly budgetMs: number;
  readonly elapsedMs: number;
}

export interface DevelopmentSmokeOptions {
  /** 단계별 상한. 생략한 단계는 {@link defaultStageBudgetsMs}를 쓴다. */
  readonly stageBudgetsMs?: Partial<Record<DevelopmentSmokeStageName, number>>;
}

export interface DevelopmentSmokeResult {
  readonly compiler: "tsc";
  readonly nestExecutableFound: boolean;
  readonly initialBootObserved: boolean;
  readonly recompilationObserved: boolean;
  readonly restartObserved: boolean;
  readonly stages: readonly DevelopmentSmokeStage[];
}

/**
 * 단계 상한은 6코어/12스레드 Windows에서 실측한 값의 약 3배다. 유휴에서 6.6/8.7/2.3/5.7초,
 * CPU worker 20개와 dataplane pytest를 같이 돌린 부하에서 34.4/40.6/14.6/25.3초가 나왔고 상한은
 * 그 부하 측정치의 3배 이상으로 잡았다. 이 smoke는 다른 에이전트의 pnpm install·pytest와 같은
 * 머신에서 도는 것을 전제로 하므로 느려진 단계를 실패로 바꾸면 안 되고, 대신 진짜로 멈춘 단계만
 * 러너 타임아웃보다 먼저 잡는다. 단계 합계는 테스트가 지정하는 러너 타임아웃보다 반드시 작아야
 * 정리 코드가 다음 테스트 파일로 새지 않는다.
 */
export const defaultStageBudgetsMs: Record<DevelopmentSmokeStageName, number> = {
  "초기 compile": 120_000,
  "초기 기동": 150_000,
  재compile: 50_000,
  재시작: 90_000,
};

/** 러너 타임아웃을 이 값보다 넉넉히 크게 잡아야 이 모듈이 먼저 실패하고 스스로 정리한다. */
export const developmentSmokeBudgetMs = Object.values(defaultStageBudgetsMs)
  .reduce((total, budget) => total + budget, 0);

const bootMarker = '"event":"application_ready"';
const mutationMarker = "eatbid development smoke mutation";
const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const tailLimit = 8_000;
const pollIntervalMs = 50;
const childExitGraceMs = 15_000;

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

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * 자식이 완전히 죽은 것을 확인한 뒤에야 임시 디렉터리를 지운다. Windows에서 `node --watch`가
 * smokeRoot를 cwd로 잡고 있으면 rmSync가 EBUSY로 실패했고, 러너 타임아웃 뒤에 남은 그 실패가
 * 다음 테스트 파일에 붙어 엉뚱한 테스트를 깨뜨렸다.
 */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolvePromise) => child.once("exit", () => resolvePromise()));
  if (child.pid) terminateTree(child.pid);
  await Promise.race([exited, delay(childExitGraceMs)]);
}

async function removeSmokeDirectory(smokeRoot: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      rmSync(smokeRoot, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await delay(200);
    }
  }
  throw lastError;
}

/** 청크 경계에 걸친 marker까지 세면서도 누적 출력 전체를 매번 다시 훑지 않는다. */
function createMarkerCounter(marker: string): { push: (text: string) => void; count: () => number } {
  let carry = "";
  let total = 0;
  return {
    push(text: string): void {
      const combined = carry + text;
      total += combined.split(marker).length - 1;
      carry = combined.slice(-(marker.length - 1));
    },
    count: () => total,
  };
}

function compiledOutputMtimeMs(smokeRoot: string): number | undefined {
  try {
    return statSync(join(smokeRoot, "dist/main.js")).mtimeMs;
  } catch {
    return undefined;
  }
}

function formatStages(stages: readonly DevelopmentSmokeStage[]): string {
  if (stages.length === 0) return "없음";
  return stages.map((stage) => `${stage.name} ${stage.elapsedMs}ms`).join(", ");
}

interface StageContext {
  readonly child: ChildProcess;
  readonly budgets: Record<DevelopmentSmokeStageName, number>;
  readonly stages: DevelopmentSmokeStage[];
  readonly tail: () => string;
}

/**
 * 한 단계를 그 단계의 상한 안에서만 기다린다. 실패 메시지에 단계 이름·경과·상한·직전 단계들과 마지막
 * 출력을 담아 "30초 타임아웃" 대신 어느 단계가 얼마나 걸리다 멈췄는지 말하게 한다.
 */
async function awaitStage(
  context: StageContext,
  name: DevelopmentSmokeStageName,
  isDone: () => boolean,
): Promise<void> {
  const budgetMs = context.budgets[name];
  const startedAt = Date.now();
  while (!isDone()) {
    if (context.child.exitCode !== null || context.child.signalCode !== null) {
      throw new Error(
        `development smoke: '${name}' 단계에서 dev 명령이 먼저 종료했다`
        + ` (exit=${context.child.exitCode} signal=${context.child.signalCode},`
        + ` ${Date.now() - startedAt}ms 경과, 앞선 단계: ${formatStages(context.stages)}).`
        + `\n${context.tail()}`,
      );
    }
    if (Date.now() - startedAt >= budgetMs) {
      throw new Error(
        `development smoke: '${name}' 단계가 상한 ${budgetMs}ms를 넘겼다`
        + ` (${Date.now() - startedAt}ms 경과, 앞선 단계: ${formatStages(context.stages)}).`
        + `\n${context.tail()}`,
      );
    }
    await delay(pollIntervalMs);
  }
  context.stages.push({ name, budgetMs, elapsedMs: Date.now() - startedAt });
}

export async function runDevelopmentSmoke(
  options: DevelopmentSmokeOptions = {},
): Promise<DevelopmentSmokeResult> {
  const serverRoot = resolve(toolsDirectory, "..");
  const budgets = { ...defaultStageBudgetsMs, ...options.stageBudgetsMs };
  const path = sanitizedPath();
  const pathProbe = spawnSync(process.platform === "win32" ? "where.exe" : "which", ["nest"], {
    env: { ...process.env, PATH: path },
    windowsHide: true,
  });
  const nestExecutableFound = pathProbe.status === 0
    || existsSync(join(serverRoot, "node_modules/.bin/nest"))
    || existsSync(join(serverRoot, "node_modules/.bin/nest.cmd"));
  // 임시 디렉터리는 이 검사를 통과한 뒤에 만든다. 먼저 만들면 여기서 던질 때 그대로 남는다.
  if (nestExecutableFound) throw new Error("Development smoke requires PATH without a Nest CLI executable");

  const smokeRoot = mkdtempSync(join(tmpdir(), "eatbid-server-dev-smoke-"));
  const stages: DevelopmentSmokeStage[] = [];
  let child: ChildProcess | undefined;
  let primaryError: unknown;
  let result: DevelopmentSmokeResult | undefined;

  try {
    cpSync(join(serverRoot, "src"), join(smokeRoot, "src"), { recursive: true });
    for (const file of ["package.json", "tsconfig.json", "tsconfig.build.json"]) {
      copyFileSync(join(serverRoot, file), join(smokeRoot, file));
    }
    symlinkSync(join(serverRoot, "node_modules"), join(smokeRoot, "node_modules"), "junction");

    child = spawn("pnpm", ["run", "dev"], {
      cwd: smokeRoot,
      env: {
        ...process.env,
        PATH: path,
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        NODE_ENV: "test",
        DATABASE_URL: "postgres://eatbid_api:test-only@127.0.0.1:1/eatbid_test",
        PORT: "0",
      },
      shell: true,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });

    let tail = "";
    const boots = createMarkerCounter(bootMarker);
    const mutations = createMarkerCounter(mutationMarker);
    const observe = (chunk: Buffer): void => {
      const text = chunk.toString("utf8");
      boots.push(text);
      mutations.push(text);
      tail = (tail + text).slice(-tailLimit);
    };
    child.stdout?.on("data", observe);
    child.stderr?.on("data", observe);

    const context: StageContext = {
      child,
      budgets,
      stages,
      tail: () => `마지막 출력 ${tailLimit}자:\n${tail}`,
    };

    // 단계 경계는 언어에 의존하지 않는 증거만 쓴다. tsc의 watch 메시지는 OS UI 언어를 따라가므로
    // 산출물 mtime과 애플리케이션 자신의 구조화 로그로 compile과 기동을 가른다.
    await awaitStage(context, "초기 compile", () => compiledOutputMtimeMs(smokeRoot) !== undefined);
    await awaitStage(context, "초기 기동", () => boots.count() >= 1);

    const compiledAtBoot = compiledOutputMtimeMs(smokeRoot) ?? 0;
    appendFileSync(
      join(smokeRoot, "src/main.ts"),
      `\nconsole.log(${JSON.stringify(mutationMarker)});\n`,
      "utf8",
    );

    await awaitStage(context, "재compile", () => (compiledOutputMtimeMs(smokeRoot) ?? 0) > compiledAtBoot);
    await awaitStage(context, "재시작", () => boots.count() >= 2 && mutations.count() >= 1);

    result = {
      compiler: "tsc",
      nestExecutableFound,
      initialBootObserved: boots.count() >= 1,
      recompilationObserved: mutations.count() >= 1,
      restartObserved: boots.count() >= 2,
      stages,
    };
  } catch (error) {
    primaryError = error;
  }

  if (child) await stopChild(child);
  const expectedPrefix = resolve(tmpdir(), "eatbid-server-dev-smoke-").toLowerCase();
  if (!resolve(smokeRoot).toLowerCase().startsWith(expectedPrefix)) {
    throw new Error(`Refusing to remove unexpected smoke directory: ${smokeRoot}`);
  }
  try {
    await removeSmokeDirectory(smokeRoot);
  } catch (cleanupError) {
    // 정리 실패로 원래 원인을 덮지 않는다. 원인이 없을 때만 정리 실패 자체를 보고한다.
    if (primaryError === undefined) {
      throw new Error(`development smoke: 임시 디렉터리 ${smokeRoot} 정리 실패`, { cause: cleanupError });
    }
  }

  if (primaryError !== undefined) throw primaryError;
  return result as DevelopmentSmokeResult;
}

if (import.meta.main) {
  const smoke = await runDevelopmentSmoke();
  console.log(JSON.stringify(smoke));
}
