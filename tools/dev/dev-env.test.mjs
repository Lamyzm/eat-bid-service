import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import {
  apiDatabaseUrl,
  devEnvPath,
  fillMissingSecrets,
  formatEnvFile,
  mergeEnvironment,
  ownerDatabaseUrl,
  parseEnvFile,
  readDevEnvFile,
  runtimeEnvironment,
  writeDevEnvFile,
} from "./dev-env.mjs";

const SAMPLE_CONFIG = {
  EATBID_DEV_DB_CONTAINER: "eatbid-dev",
  EATBID_DEV_DB_NAME: "eatbid_dev",
  EATBID_DEV_DB_PORT: "15433",
  EATBID_DEV_API_PORT: "4300",
  EATBID_DEV_WEB_PORT: "3000",
  EATBID_DEV_DB_OWNER_PASSWORD: "owner",
  EATBID_DEV_DB_API_PASSWORD: "api",
  BETTER_AUTH_SECRET: "secret",
};

describe("개발 환경 파일 읽고 쓰기", () => {
  test("주석과 빈 줄을 건너뛰고 첫 등호만 구분자로 본다", () => {
    assert.deepEqual(
      parseEnvFile("# 설명\n\nA=1\nB=pa=ss\n  C = 3  \n"),
      { A: "1", B: "pa=ss", C: "3" },
    );
  });

  test("소유한 키만 적고 모르는 키는 파일에 남기지 않는다", () => {
    const text = formatEnvFile({ ...SAMPLE_CONFIG, WHATEVER: "x" });
    assert.match(text, /BETTER_AUTH_SECRET=secret/);
    assert.doesNotMatch(text, /WHATEVER/);
  });

  test("쓴 파일을 다시 읽으면 같은 값이 나온다", () => {
    const environment = { EATBID_DEV_HOME: mkdtempSync(path.join(tmpdir(), "eatbid-dev-")) };
    const written = writeDevEnvFile(SAMPLE_CONFIG, environment);
    assert.equal(written, devEnvPath(environment));
    assert.match(readFileSync(written, "utf8"), /EATBID_DEV_DB_PORT=15433/);
    assert.equal(readDevEnvFile(environment).BETTER_AUTH_SECRET, "secret");
  });

  test("파일이 없으면 빈 값으로 시작한다", () => {
    const environment = { EATBID_DEV_HOME: path.join(tmpdir(), "eatbid-dev-없는곳") };
    assert.deepEqual(readDevEnvFile(environment), {});
  });
});

describe("한 번만 만드는 비밀값", () => {
  test("이미 있는 세션 열쇠는 덮어쓰지 않는다", () => {
    const filled = fillMissingSecrets({ BETTER_AUTH_SECRET: "이미-있던-열쇠" });
    assert.equal(filled.BETTER_AUTH_SECRET, "이미-있던-열쇠");
  });

  test("없는 비밀은 채우고 연결 문자열에 인코딩이 필요한 글자를 만들지 않는다", () => {
    const filled = fillMissingSecrets({});
    assert.match(filled.BETTER_AUTH_SECRET, /^[0-9a-f]{64}$/);
    assert.match(filled.EATBID_DEV_DB_API_PASSWORD, /^[0-9a-f]{32}$/);
    assert.equal(filled.EATBID_DEV_DB_CONTAINER, "eatbid-dev");
  });

  test("세션 열쇠는 Better Auth가 요구하는 32자를 넘는다", () => {
    assert.ok(fillMissingSecrets({}).BETTER_AUTH_SECRET.length >= 32);
  });
});

describe("환경 우선순위와 파생 연결 문자열", () => {
  test("프로세스 환경이 기기 파일을 이긴다", () => {
    const merged = mergeEnvironment(SAMPLE_CONFIG, { EATBID_DEV_API_PORT: "4301" });
    assert.equal(merged.EATBID_DEV_API_PORT, "4301");
    assert.equal(merged.EATBID_DEV_WEB_PORT, "3000");
  });

  test("빈 문자열은 선택이 아니라 없음으로 본다", () => {
    assert.equal(mergeEnvironment(SAMPLE_CONFIG, { EATBID_DEV_API_PORT: "" }).EATBID_DEV_API_PORT, "4300");
  });

  test("owner와 api는 같은 데이터베이스를 다른 역할로 연다", () => {
    assert.equal(ownerDatabaseUrl(SAMPLE_CONFIG), "postgres://eatbid_owner:owner@127.0.0.1:15433/eatbid_dev");
    assert.equal(apiDatabaseUrl(SAMPLE_CONFIG), "postgres://eatbid_api:api@127.0.0.1:15433/eatbid_dev");
  });

  test("기동 환경은 web origin 하나로 인증 URL과 CORS를 함께 맞춘다", () => {
    const runtime = runtimeEnvironment(SAMPLE_CONFIG);
    assert.equal(runtime.BETTER_AUTH_URL, "http://localhost:3000");
    assert.equal(runtime.CORS_ORIGINS, "http://localhost:3000");
    assert.equal(runtime.API_URL, "http://localhost:4300");
    assert.equal(runtime.EATBID_DEV_LOGIN, "true");
    assert.equal(runtime.NODE_ENV, "development");
    assert.equal(runtime.PORT, undefined);
  });
});
