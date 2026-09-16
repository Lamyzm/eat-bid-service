/**
 * @module 책임: 커밋된 migration과 배포되는 권한 파일 그대로 격리 PostgreSQL container를 세우고
 * owner·api·dataplane 역할 연결과 container 정리 확인을 통합 검사에 빌려준다.
 *
 * 권한 계약을 실제로 실행하는 검사가 둘 이상이므로 수명주기를 한 곳에 둔다. 검사마다 harness를
 * 복제하면 fixture가 배포 파일 대신 자기 GRANT를 적는 순간을 아무도 막지 못한다.
 */
import { expect } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export const repositoryRoot = resolve(import.meta.dir, "../../..");
export const migrationFolder = resolve(repositoryRoot, "packages/db/drizzle");
// 배포되는 권한 선언 그 자체를 실행한다. fixture가 GRANT를 따로 적으면 readiness 계약이 통과해도
// 클러스터에 같은 권한이 선다는 보장이 없어진다(2026-09-04 server 503, 2026-09-05 dataplane exit 64).
export const provisioningSqlPath = resolve(repositoryRoot, "infra/base/db-provisioning.sql");
const provisioningSql = readFileSync(provisioningSqlPath, "utf8");
const postgresImage = "postgres:16-alpine@sha256:20edbde7749f822887a1a022ad526fde0a47d6b2be9a8364433605cf65099416";

export const sqlText = (value: string): string => value.replaceAll("'", "''");

export async function docker(...args: string[]): Promise<string> {
  const child = Bun.spawn(["docker", ...args], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error(`docker ${args[0]} failed: ${stderr.trim()}`);
  return stdout.trim();
}

export async function expectDenied(label: string, work: () => Promise<unknown>): Promise<void> {
  let denied = false;
  try {
    await work();
  } catch {
    denied = true;
  }
  expect(denied, `${label} must be denied`).toBe(true);
}

export interface DisposableDatabase {
  readonly ownerUrl: string;
  readonly apiUrl: string;
  // mart 빌드를 Argo `marts` 단계가 실행하므로 dataplane 역할의 권한도 같은 배포 파일이 증명해야 한다.
  readonly dataplaneUrl: string;
  readonly owner: ReturnType<typeof postgres>;
  readonly api: ReturnType<typeof postgres>;
}

export interface DisposableDatabaseOptions {
  /** container 이름과 label에 함께 들어가는 검사 식별자다. 같은 label을 쓰는 다른 프로세스의 container를 소유로 보지 않게 한다. */
  readonly task: string;
  /** migration 재적용 멱등성까지 증명하는 검사만 2 이상을 쓴다. */
  readonly migrationApplyCount: number;
  /** 역할 생성과 권한 적용 전에 owner로 실행하는 fixture다. 여기서 만든 표에도 provisioning이 권한을 준다. */
  readonly seed: (owner: ReturnType<typeof postgres>) => Promise<void>;
}

export function disposableDatabase(options: DisposableDatabaseOptions) {
  const taskLabel = `eatbid.task=${options.task}`;
  // 이 실행이 직접 만든 container만 소유로 본다. 같은 label은 다른 프로세스가 같은 파일을 동시에
  // 돌릴 때도 붙으므로 label만으로 판정하면 남이 정리 중인 container가 이 실행을 실패시킨다.
  const ownedContainerPrefix = `eatbid-${options.task}-${process.pid}-`;

  async function ownedTaskContainers(): Promise<string[]> {
    const output = await docker(
      "ps", "-a",
      "--filter", `label=${taskLabel}`,
      "--filter", `name=^${ownedContainerPrefix}`,
      "--format", "{{.Names}}",
    );
    return output ? output.split(/\r?\n/) : [];
  }

  /**
   * `docker run --rm`의 삭제는 container가 멈춘 뒤 daemon이 비동기로 끝낸다. 한 번만 조회하면 정리에
   * 성공한 실행도 아직 목록에 남은 이름 때문에 실패하므로 상한 안에서 비워지기를 기다린다. 상한을
   * 넘기면 남은 이름을 그대로 드러내 진짜 누수와 반영 지연을 구분한다.
   */
  async function expectOwnedContainersCleanedUp(): Promise<void> {
    const deadline = Date.now() + 30_000;
    let remaining = await ownedTaskContainers();
    while (remaining.length > 0 && Date.now() < deadline) {
      await Bun.sleep(200);
      remaining = await ownedTaskContainers();
    }
    expect(remaining).toEqual([]);
  }

  /**
   * 단언 전에 container 기동·준비 대기·migration·seed·provisioning을 차례로 거쳐 `bun test --timeout`
   * 기본값으로는 여유가 없으므로, 호출하는 test는 개별 timeout override를 반드시 넘긴다(2026-09-10 push gate 불안정).
   */
  async function withDatabase<A>(work: (database: DisposableDatabase) => Promise<A>): Promise<A> {
    const name = `${ownedContainerPrefix}${Date.now()}`;
    let owner: ReturnType<typeof postgres> | undefined;
    let api: ReturnType<typeof postgres> | undefined;
    await docker(
      "run", "--detach", "--rm",
      "--name", name,
      "--label", taskLabel,
      "--env", "POSTGRES_USER=eatbid_owner",
      "--env", "POSTGRES_PASSWORD=owner-test-secret",
      "--env", "POSTGRES_DB=eatbid_test",
      "--publish", "127.0.0.1::5432",
      postgresImage,
    );
    try {
      const portOutput = await docker("port", name, "5432/tcp");
      const port = portOutput.match(/:(\d+)$/)?.[1];
      if (!port) throw new Error(`Could not determine PostgreSQL port from ${portOutput}`);
      const ownerUrl = `postgres://eatbid_owner:owner-test-secret@127.0.0.1:${port}/eatbid_test`;
      const apiUrl = `postgres://eatbid_api:api-test-secret@127.0.0.1:${port}/eatbid_test`;
      const dataplaneUrl = `postgres://eatbid_dataplane:dataplane-test-secret@127.0.0.1:${port}/eatbid_test`;
      owner = postgres(ownerUrl, { max: 1, connect_timeout: 1, onnotice: () => undefined });
      const deadline = Date.now() + 30_000;
      while (true) {
        try {
          await owner`select 1`;
          break;
        } catch (error) {
          if (Date.now() >= deadline) throw error;
          await Bun.sleep(100);
        }
      }
      const ownerDatabase = drizzle({ client: owner });
      for (let apply = 1; apply <= options.migrationApplyCount; apply += 1) {
        const failure = await migrate(ownerDatabase, { migrationsFolder: migrationFolder });
        if (failure) throw new Error(`Migration apply ${apply} failed with ${failure.exitCode}`);
      }
      await options.seed(owner);
      // 역할 생성만 fixture의 책임이고(비밀번호는 Infisical 소유) 권한은 배포 파일이 선언한다.
      await owner.unsafe(`
        create role eatbid_migrator login password 'migrator-test-secret'
          nosuperuser nocreatedb nocreaterole noinherit;
        create role eatbid_api login password 'api-test-secret'
          nosuperuser nocreatedb nocreaterole noinherit;
        create role eatbid_dataplane login password 'dataplane-test-secret'
          nosuperuser nocreatedb nocreaterole noinherit;
        create role eatbid_grafana login password 'grafana-test-secret'
          nosuperuser nocreatedb nocreaterole noinherit;
      `);
      await owner.unsafe(provisioningSql);
      api = postgres(apiUrl, {
        max: 4,
        connect_timeout: 2,
        connection: { statement_timeout: 5_000, lock_timeout: 2_000 },
      });
      await api`select 1`;
      return await work({ ownerUrl, apiUrl, dataplaneUrl, owner, api });
    } finally {
      if (api) await api.end({ timeout: 1 }).catch(() => undefined);
      if (owner) await owner.end({ timeout: 1 }).catch(() => undefined);
      await docker("rm", "--force", name).catch(() => undefined);
    }
  }

  return { taskLabel, withDatabase, expectOwnedContainersCleanedUp };
}
