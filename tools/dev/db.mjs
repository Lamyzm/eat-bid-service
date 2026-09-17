/**
 * @module 책임: 개발 DB(2층)를 명령 하나로 세우고 버리는 CLI다. 빈 PostgreSQL 기동, migration 전량 적용,
 * 역할·권한 부여, 로그인 계정 시드, 커밋된 합성 표본 적재까지를 한 순서로 묶는다.
 *
 * 되돌리는 길을 하나만 둔다. `up`과 `reset`뿐이고 **부분 수정·복구 명령은 없다.** 2026-09-17에 손으로
 * 고친 개발 DB가 journal은 29개라고 말하는데 `ingest`에 표가 하나도 없는 상태로 굳어 하루치 작업이
 * 멈췄다. 스키마가 어긋나면 고치는 것이 아니라 버리고 다시 만든다(EAT-271, AGENTS 10).
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  containerState,
  countCommittedMigrations,
  queryValue,
  removeContainer,
  runSql,
  startContainer,
  waitForReady,
} from "./container.mjs";
import {
  PORT_SEARCH_START,
  apiDatabaseUrl,
  fillMissingSecrets,
  mergeEnvironment,
  ownerDatabaseUrl,
  readDevEnvFile,
  runtimeEnvironment,
  writeDevEnvFile,
  devEnvPath,
} from "./dev-env.mjs";
import { assertPortUsable, choosePort, isPortExcluded, isPortFree, readExcludedPortRanges } from "./ports.mjs";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const migrationFolder = path.join(repoRoot, "packages/db/drizzle");
const provisioningPath = path.join(repoRoot, "infra/base/db-provisioning.sql");
const sampleFolder = path.join(import.meta.dirname, "sample");

const ROLES = ["eatbid_migrator", "eatbid_api", "eatbid_dataplane", "eatbid_grafana"];
const ROLE_PASSWORD_KEY = {
  eatbid_migrator: "EATBID_DEV_DB_MIGRATOR_PASSWORD",
  eatbid_api: "EATBID_DEV_DB_API_PASSWORD",
  eatbid_dataplane: "EATBID_DEV_DB_DATAPLANE_PASSWORD",
  eatbid_grafana: "EATBID_DEV_DB_GRAFANA_PASSWORD",
};

function say(message) {
  process.stdout.write(`${message}\n`);
}

/**
 * Windows에서 pnpm은 `.cmd` shim이라 Node 24의 spawnSync가 shell 없이 EINVAL로 거절한다. 인자를
 * 따로 넘기지 않고 한 문자열로 합치는 이유는 shell에 넘기는 인자 배열이 이스케이프되지 않기
 * 때문이며(DEP0190), 이 자리의 인자는 전부 이 파일이 적은 고정 문자열이다.
 */
function pnpm(args, environment) {
  const result = spawnSync(`pnpm ${args.join(" ")}`, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, ...environment },
  });
  if (result.error) throw new Error(`pnpm을 실행하지 못했습니다: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`pnpm ${args.join(" ")} 실패(exit ${result.status})`);
}

/** 갓 받은 저장소에는 node_modules가 없다. 두 명령 안에 화면을 보려면 이 단계도 도구가 맡는다. */
function ensureDependencies() {
  if (existsSync(path.join(repoRoot, "node_modules"))) return;
  say("0/5 의존성 설치");
  pnpm(["install", "--frozen-lockfile"], {});
}

/**
 * 포트는 세 곳에서 온다. 프로세스 환경이 가장 세고, 그다음이 기기 파일이며, 아무것도 없으면 빈 자리를
 * 찾아 파일에 적는다. 환경으로 못 박은 값은 못 쓰더라도 옮기지 않는다 — 사용자가 고른 자리를 도구가
 * 조용히 바꾸면 열어 둔 주소가 다른 곳을 가리킨다.
 */
export async function resolvePorts(config, {
  ranges,
  environment = process.env,
  databasePortHeld = false,
  free = isPortFree,
}) {
  const resolved = { ...config };
  for (const [key, from] of Object.entries(PORT_SEARCH_START)) {
    const current = resolved[key] === undefined ? undefined : Number(resolved[key]);
    if (environment[key] !== undefined && environment[key] !== "") {
      if (isPortExcluded(current, ranges)) {
        throw new Error(
          `${key}=${current}은 Windows 예약 대역입니다.`
            + " netsh interface ipv4 show excludedportrange protocol=tcp 로 확인하세요.",
        );
      }
      resolved[key] = String(current);
      continue;
    }
    // 이미 떠 있는 컨테이너가 자기 포트를 잡고 있으므로 그 한 자리만 빈자리 검사에서 뺀다.
    const held = databasePortHeld && key === "EATBID_DEV_DB_PORT";
    if (current !== undefined && (held || (!isPortExcluded(current, ranges) && await free(current)))) {
      resolved[key] = String(current);
      continue;
    }
    resolved[key] = String(await choosePort({ from: current ?? from, ranges, free }));
    say(`${key}: ${resolved[key]} (빈 자리를 찾아 ${devEnvPath(environment)}에 적었습니다)`);
  }
  return resolved;
}

function appliedMigrationCount(config) {
  return Number(queryValue(
    config.EATBID_DEV_DB_CONTAINER,
    "select count(*) from drizzle.__drizzle_migrations",
    { database: config.EATBID_DEV_DB_NAME },
  ));
}

function sampleSqlFiles() {
  return readdirSync(sampleFolder)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => path.join(sampleFolder, name));
}

function createRolesSql(config) {
  return ROLES.map((role) =>
    `create role ${role} login password '${config[ROLE_PASSWORD_KEY[role]]}'`
    + " nosuperuser nocreatedb nocreaterole noinherit;").join("\n");
}

function buildDatabase(config) {
  const container = config.EATBID_DEV_DB_CONTAINER;
  const database = config.EATBID_DEV_DB_NAME;

  say("2/5 migration 전량 적용");
  pnpm(["db:migrate"], { DATABASE_URL: ownerDatabaseUrl(config) });

  say("3/5 역할 생성과 배포 권한 파일 적용");
  runSql(container, createRolesSql(config), { database });
  runSql(container, readFileSync(provisioningPath, "utf8"), { database });

  say("4/5 개발 로그인 계정 시드");
  pnpm(["--filter", "@eatbid/server", "seed:dev-login"], runtimeEnvironment(config));

  say("5/5 합성 표본 자료 적재");
  for (const file of sampleSqlFiles()) {
    runSql(container, readFileSync(file, "utf8"), { database });
  }
}

/**
 * 재사용 여부는 묻지 않고 규칙으로 정한다. 켜져 있으면 그대로 쓰고, 꺼져 있으면 켜고, 스키마가
 * 저장소와 어긋나면 고치지 않고 `reset`을 요구한다.
 */
function verifySchema(config) {
  const applied = appliedMigrationCount(config);
  const committed = countCommittedMigrations(migrationFolder);
  if (applied !== committed) {
    throw new Error(
      `적용된 migration ${applied}개가 저장소의 ${committed}개와 다릅니다.`
        + " 고쳐 쓰지 말고 pnpm dev:db reset 으로 다시 만드세요.",
    );
  }
  return { applied, committed };
}

function rowCounts(config) {
  const output = queryValue(
    config.EATBID_DEV_DB_CONTAINER,
    `select 'mart.open_auction_snapshot=' || (select count(*) from mart.open_auction_snapshot)
       || ' mart.org_round_summary=' || (select count(*) from mart.org_round_summary)
       || ' core.bid_submission=' || (select count(*) from core.bid_submission)
       || ' core.auction_revision=' || (select count(*) from core.auction_revision)
       || ' 활성build=' || (select count(*) from mart.build where status = 'active')
       || ' 열린공고=' || (select count(*) from mart.open_auction_snapshot snapshot
            join mart.build build on build.build_id = snapshot.build_id
           where build.status = 'active' and build.mart_name = 'open_auction_snapshot'
             and (snapshot.closes_at is null or snapshot.closes_at > now())
             and (snapshot.source_status_label is null
                  or snapshot.source_status_label <> '공고취소'))`,
    { database: config.EATBID_DEV_DB_NAME },
  );
  return output;
}

function printSummary(config) {
  const { applied, committed } = verifySchema(config);
  say("");
  say(`컨테이너   ${config.EATBID_DEV_DB_CONTAINER} (${containerState(config.EATBID_DEV_DB_CONTAINER)})`);
  say(`migration  ${applied}/${committed}`);
  say(`표본       ${rowCounts(config)}`);
  say(`DATABASE_URL  ${apiDatabaseUrl(config)}`);
  say(`API            http://localhost:${config.EATBID_DEV_API_PORT}  (스웨거 /docs)`);
  say(`Web            http://localhost:${config.EATBID_DEV_WEB_PORT}`);
  say(`로그인         dev@eatbid.local / eatbid-dev-login`);
  say("");
  say("다음 명령: pnpm dev:local  (server와 web을 이 환경으로 함께 띄운다)");
}

async function up({ environment = process.env } = {}) {
  const stored = fillMissingSecrets(readDevEnvFile(environment));
  const merged = mergeEnvironment(stored, environment);
  const ranges = readExcludedPortRanges();
  const state = containerState(merged.EATBID_DEV_DB_CONTAINER);
  const config = await resolvePorts(merged, { ranges, environment, databasePortHeld: state !== "missing" });
  writeDevEnvFile(config, environment);

  if (state === "missing") {
    ensureDependencies();
    await assertPortUsable(Number(config.EATBID_DEV_DB_PORT), { ranges, label: "개발 DB" });
    say(`1/5 빈 PostgreSQL 기동 (${config.EATBID_DEV_DB_CONTAINER}:${config.EATBID_DEV_DB_PORT})`);
    startContainer({
      name: config.EATBID_DEV_DB_CONTAINER,
      port: config.EATBID_DEV_DB_PORT,
      database: config.EATBID_DEV_DB_NAME,
      ownerPassword: config.EATBID_DEV_DB_OWNER_PASSWORD,
    });
    waitForReady(config.EATBID_DEV_DB_CONTAINER);
    buildDatabase(config);
  } else {
    if (state === "stopped") {
      say(`멈춰 있던 ${config.EATBID_DEV_DB_CONTAINER}을(를) 다시 켭니다`);
      spawnSync("docker", ["start", config.EATBID_DEV_DB_CONTAINER], { stdio: "inherit" });
      waitForReady(config.EATBID_DEV_DB_CONTAINER);
    }
    say(`이미 있는 ${config.EATBID_DEV_DB_CONTAINER}을(를) 그대로 씁니다`);
  }

  printSummary(config);
}

async function reset({ environment = process.env } = {}) {
  const stored = fillMissingSecrets(readDevEnvFile(environment));
  const config = mergeEnvironment(stored, environment);
  say(`버립니다: ${config.EATBID_DEV_DB_CONTAINER}`);
  removeContainer(config.EATBID_DEV_DB_CONTAINER);
  await up({ environment });
}

function down({ environment = process.env } = {}) {
  const config = mergeEnvironment(fillMissingSecrets(readDevEnvFile(environment)), environment);
  removeContainer(config.EATBID_DEV_DB_CONTAINER);
  say(`버렸습니다: ${config.EATBID_DEV_DB_CONTAINER}. 다시 만들려면 pnpm dev:db up`);
}

function status({ environment = process.env } = {}) {
  const config = mergeEnvironment(fillMissingSecrets(readDevEnvFile(environment)), environment);
  const state = containerState(config.EATBID_DEV_DB_CONTAINER);
  if (state !== "running") {
    say(`${config.EATBID_DEV_DB_CONTAINER}: ${state}. pnpm dev:db up 으로 만드세요.`);
    return;
  }
  printSummary(config);
}

const USAGE = `사용: pnpm dev:db <up|reset|down|status>

  up      없으면 만들고 있으면 그대로 쓴다. 스키마가 저장소와 다르면 고치지 않고 거부한다.
  reset   버리고 처음부터 다시 만든다. 어긋난 개발 DB의 유일한 해결책이다.
  down    버린다. e2e처럼 포트를 다투는 작업 전에 쓴다.
  status  지금 상태와 접속 정보를 보여 준다(아무것도 바꾸지 않는다).`;

export async function main(argv) {
  const command = argv[0] ?? "up";
  if (command === "up") return up();
  if (command === "reset") return reset();
  if (command === "down") return down();
  if (command === "status") return status();
  say(USAGE);
  process.exitCode = 64;
  return undefined;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
