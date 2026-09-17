/**
 * @module 책임: 개발 DB 컨테이너의 수명주기(있는지·띄우기·버리기·준비 대기)와 그 안의 psql 실행을
 * 한 곳에서 맡고, 커밋된 migration 수와 실제로 적용된 수를 세는 방법을 소유한다.
 *
 * 컨테이너를 고치는 명령은 여기에 없다. 상태가 어긋나면 버리고 다시 만드는 길 하나만 둔다 — 손으로
 * 고친 개발 DB는 아무도 재현하지 못하고, 죽으면 그대로 끝난다(EAT-271).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";

/** 통합 검사가 쓰는 것과 같은 고정 이미지다. 두 자리가 다른 PostgreSQL을 보면 재현이 깨진다. */
export const POSTGRES_IMAGE =
  "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";

export function docker(args, { input, allowFailure = false } = {}) {
  const result = spawnSync("docker", args, { input, encoding: "utf8" });
  if (result.error) throw new Error(`docker를 실행하지 못했습니다: ${result.error.message}`);
  if (!allowFailure && result.status !== 0) {
    throw new Error(`docker ${args[0]} 실패(exit ${result.status}): ${result.stderr.trim()}`);
  }
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function containerState(name) {
  const result = docker(["inspect", "--format", "{{.State.Running}}", name], { allowFailure: true });
  if (result.status !== 0) return "missing";
  return result.stdout.trim() === "true" ? "running" : "stopped";
}

export function removeContainer(name) {
  docker(["rm", "--force", "--volumes", name], { allowFailure: true });
}

/**
 * 이름 붙은 volume을 쓰지 않는다. 컨테이너를 지우면 자료도 함께 사라져야 `reset`이 정말로 처음부터
 * 다시 만드는 명령이 된다. 살려 둔 volume 하나가 다음 사람에게 "왜 이 행이 여기 있지"를 남긴다.
 */
export function startContainer({ name, port, database, ownerPassword }) {
  docker([
    "run", "--detach",
    "--name", name,
    "--label", "eatbid.layer=dev-database",
    "--env", "POSTGRES_USER=eatbid_owner",
    "--env", `POSTGRES_PASSWORD=${ownerPassword}`,
    "--env", `POSTGRES_DB=${database}`,
    "--publish", `127.0.0.1:${port}:5432`,
    POSTGRES_IMAGE,
  ]);
}

/** 동기 흐름 한가운데서 기다린다. 이 CLI는 단계 순서가 곧 안전장치라 병렬로 나눌 것이 없다. */
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

export function waitForReady(name, { deadlineMs = 60_000, now = Date.now } = {}) {
  const deadline = now() + deadlineMs;
  while (now() < deadline) {
    const ready = docker(["exec", name, "pg_isready", "-U", "eatbid_owner"], { allowFailure: true });
    if (ready.status === 0) return;
    sleepSync(300);
  }
  throw new Error(`컨테이너 ${name}이(가) ${deadlineMs}ms 안에 준비되지 않았습니다`);
}

/**
 * `--single-transaction`과 `ON_ERROR_STOP`을 함께 건다. 표본 자료가 중간에 끊긴 채 남으면 그것이
 * 바로 이 이슈가 없애려는 상태다 — 다 들어가거나 하나도 안 들어가거나 둘뿐이다.
 */
export function runSql(name, sql, { database, user = "eatbid_owner" } = {}) {
  const result = docker(
    ["exec", "--interactive", name, "psql", "--username", user, "--dbname", database,
      "--no-psqlrc", "--quiet", "--single-transaction",
      "--set", "ON_ERROR_STOP=1", "--file", "-"],
    { input: sql, allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(`psql 실패(exit ${result.status}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return result.stdout;
}

export function queryValue(name, sql, { database, user = "eatbid_owner" } = {}) {
  const result = docker(
    ["exec", "--interactive", name, "psql", "--username", user, "--dbname", database,
      "--no-psqlrc", "--quiet", "--tuples-only", "--no-align",
      "--set", "ON_ERROR_STOP=1", "--command", sql],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    throw new Error(`psql 조회 실패(exit ${result.status}): ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

/**
 * 커밋된 migration은 `packages/db/drizzle` 아래의 폴더 하나가 하나다. drizzle 1.x는 journal 파일을
 * 따로 두지 않으므로 폴더를 세는 것이 저장소가 말하는 개수다.
 */
export function countCommittedMigrations(folder) {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{14}_/.test(entry.name))
    .length;
}
