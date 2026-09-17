/**
 * @module 책임: 기기마다 한 번만 만드는 개발 환경 파일(포트·역할 비밀번호·세션 열쇠)의 자리와 읽기·쓰기,
 * 그리고 그 값에서 파생하는 연결 문자열·기동 환경변수를 소유한다.
 *
 * 세션 열쇠를 실행마다 새로 만들면 API를 다시 띄울 때마다 브라우저 로그인이 끊긴다. 그렇다고 저장소에
 * 고정값을 적으면 `development`로 띄운 공유 환경의 세션을 누구나 위조할 수 있다(local-dev-login.md §5).
 * 그래서 값은 기기에서 한 번 만들어 저장소 밖 파일에 남기고, 그 뒤로는 읽기만 한다.
 *
 * 파일이 저장소 밖에 있는 이유는 worktree마다 다른 열쇠가 생기면 같은 컨테이너에 붙은 두 worktree의
 * 세션이 서로를 무효로 만들기 때문이다.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** 이 파일이 소유하는 키다. 여기에 없는 이름은 파생값이며 파일에 적지 않는다. */
export const STORED_KEYS = Object.freeze([
  "EATBID_DEV_DB_CONTAINER",
  "EATBID_DEV_DB_NAME",
  "EATBID_DEV_DB_PORT",
  "EATBID_DEV_API_PORT",
  "EATBID_DEV_WEB_PORT",
  "EATBID_DEV_DB_OWNER_PASSWORD",
  "EATBID_DEV_DB_MIGRATOR_PASSWORD",
  "EATBID_DEV_DB_API_PASSWORD",
  "EATBID_DEV_DB_DATAPLANE_PASSWORD",
  "EATBID_DEV_DB_GRAFANA_PASSWORD",
  "BETTER_AUTH_SECRET",
]);

/** 포트를 찾기 시작하는 자리다. 값 자체가 계약이 아니라 "여기서부터 비어 있는 곳"이라는 뜻이다. */
export const PORT_SEARCH_START = Object.freeze({
  EATBID_DEV_DB_PORT: 15_433,
  EATBID_DEV_API_PORT: 4_300,
  EATBID_DEV_WEB_PORT: 3_000,
});

export function devHome(environment = process.env) {
  return environment.EATBID_DEV_HOME ?? path.join(homedir(), ".eatbid");
}

export function devEnvPath(environment = process.env) {
  return path.join(devHome(environment), "dev.env");
}

export function parseEnvFile(text) {
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    entries[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return entries;
}

export function formatEnvFile(entries) {
  const header = [
    "# eatbid 개발 환경 (2층). tools/dev/db.mjs가 처음 한 번 만들고 그 뒤로는 사람이 고친다.",
    "# 저장소 밖 파일이며 운영 비밀이 아니다. 지우면 다음 `pnpm dev:db up`이 새로 만든다.",
    "",
  ];
  const body = STORED_KEYS.filter((key) => entries[key] !== undefined)
    .map((key) => `${key}=${entries[key]}`);
  return `${[...header, ...body].join("\n")}\n`;
}

export function readDevEnvFile(environment = process.env) {
  try {
    return parseEnvFile(readFileSync(devEnvPath(environment), "utf8"));
  } catch {
    return {};
  }
}

export function writeDevEnvFile(entries, environment = process.env) {
  const target = devEnvPath(environment);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, formatEnvFile(entries), { encoding: "utf8", mode: 0o600 });
  return target;
}

/** 16진수만 쓰는 이유: 연결 문자열에 그대로 들어가므로 URL 인코딩이 필요한 글자를 만들지 않는다. */
export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

/**
 * 파일에 아직 없는 값만 채운다. 이미 있는 값은 덮지 않는다 — 세션 열쇠가 바뀌면 열려 있던 로그인이
 * 전부 끊기고, 포트가 바뀌면 사용자가 열어 둔 주소가 조용히 다른 곳을 가리킨다.
 */
export function fillMissingSecrets(stored) {
  const filled = { ...stored };
  filled.EATBID_DEV_DB_CONTAINER ??= "eatbid-dev";
  filled.EATBID_DEV_DB_NAME ??= "eatbid_dev";
  for (const key of STORED_KEYS) {
    if (key.endsWith("_PASSWORD")) filled[key] ??= randomSecret(16);
  }
  filled.BETTER_AUTH_SECRET ??= randomSecret(32);
  return filled;
}

/**
 * 프로세스 환경이 언제나 이긴다. 파일은 "이 기기가 지난번에 고른 값"이지 사용자의 선택을 덮는 권위가
 * 아니다. 한 번 쓰는 다른 포트는 `EATBID_DEV_API_PORT=4301 pnpm dev:local` 한 줄로 끝나야 한다.
 */
export function mergeEnvironment(stored, environment = process.env) {
  const merged = { ...stored };
  for (const key of STORED_KEYS) {
    const override = environment[key];
    if (override !== undefined && override !== "") merged[key] = override;
  }
  return merged;
}

export function databaseUrl(config, { role, password }) {
  return `postgres://${role}:${password}@127.0.0.1:${config.EATBID_DEV_DB_PORT}/${config.EATBID_DEV_DB_NAME}`;
}

export function ownerDatabaseUrl(config) {
  return databaseUrl(config, {
    role: "eatbid_owner",
    password: config.EATBID_DEV_DB_OWNER_PASSWORD,
  });
}

export function apiDatabaseUrl(config) {
  return databaseUrl(config, {
    role: "eatbid_api",
    password: config.EATBID_DEV_DB_API_PASSWORD,
  });
}

/**
 * server와 web이 실제로 읽는 이름으로 편다. `PORT`는 두 앱이 같은 이름으로 서로 다른 값을 원하므로
 * 여기 두지 않고 프로세스를 띄우는 쪽이 각자 붙인다.
 */
export function runtimeEnvironment(config) {
  const webOrigin = `http://localhost:${config.EATBID_DEV_WEB_PORT}`;
  return {
    // server의 환경 계약은 셋 중 하나를 요구하고 기본값을 두지 않는다. 2층은 언제나 development다.
    NODE_ENV: "development",
    DATABASE_URL: apiDatabaseUrl(config),
    BETTER_AUTH_SECRET: config.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: webOrigin,
    CORS_ORIGINS: webOrigin,
    API_URL: `http://localhost:${config.EATBID_DEV_API_PORT}`,
    EATBID_DEV_LOGIN: "true",
    SWAGGER_ENABLED: "true",
    NEXT_PUBLIC_SENTRY_DISABLED: "1",
  };
}
