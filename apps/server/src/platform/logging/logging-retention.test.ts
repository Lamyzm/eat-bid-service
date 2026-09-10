import { describe, expect, test } from "bun:test";
import { fixedClock, milliseconds, Temporal } from "@eatbid/domain";
import { parseEnvironment } from "../config/environment";
import { LoggingModule, RecordingJsonLogger, RedactingJsonLogger } from "./logging.module";

const clock = fixedClock(Temporal.Instant.from("2026-08-30T09:00:00Z"));

describe("production 로거의 기록 보관(EAT-157)", () => {
  test("완료 로그를 1,000건 내도 RedactingJsonLogger는 records 필드 자체를 갖지 않는다", () => {
    const logger = new RedactingJsonLogger({ buildSha: "a".repeat(40), clock, write: () => undefined });
    for (let index = 0; index < 1_000; index += 1) {
      logger.completion({
        requestId: `req-${index}`,
        method: "GET",
        route: "/api/v1/things/:thingId",
        status: 200,
        duration: milliseconds(1),
      });
    }
    // 상한 있는 배열이 아니라 필드 자체가 없다는 것을 own property 검사로 직접 단언한다. guard 거부 하나하나가
    // 영구 객체 하나를 만들던 문제(EAT-149 이후)가 production 클래스 자체에서 구조적으로 재발할 수 없다.
    expect(Object.hasOwn(logger, "records")).toBe(false);
  });

  test("LoggingModule.create는 NODE_ENV와 무관하게 records를 보관하지 않는 로거를 만든다", () => {
    for (const NODE_ENV of ["production", "development", "test"] as const) {
      const environment = parseEnvironment({
        NODE_ENV,
        DATABASE_URL: "postgres://user:secret@127.0.0.1:1/unused",
        ...(NODE_ENV === "production" ? { CORS_ORIGINS: "https://example.com", BUILD_SHA: "a".repeat(40) } : {}),
      });
      const logger = LoggingModule.create(environment, clock, () => undefined);
      // dev-login-seed.ts 같은 CLI는 NODE_ENV가 development·test여도 이 factory만 쓴다. 그래서 분기를
      // create() 안이 아니라 이 factory를 부르는 호출부(create-app.ts)에 둔다(EAT-157).
      expect(Object.hasOwn(logger, "records")).toBe(false);
    }
  });

  test("LoggingModule.createForTest로 만든 RecordingJsonLogger는 관측을 위해 emit마다 레코드를 보관한다", () => {
    const environment = parseEnvironment({ NODE_ENV: "test", DATABASE_URL: "postgres://user:secret@127.0.0.1:1/unused" });
    const logger = LoggingModule.createForTest(environment, clock, () => undefined);
    expect(logger).toBeInstanceOf(RecordingJsonLogger);
    logger.completion({
      requestId: "req-1",
      method: "GET",
      route: "/api/v1/things/:thingId",
      status: 200,
      duration: milliseconds(1),
    });
    expect(logger.records).toHaveLength(1);
  });
});
