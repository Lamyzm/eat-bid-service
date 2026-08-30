import { describe, expect, test } from "bun:test";
import { fixedClock, milliseconds, Temporal } from "@eatbid/domain";

const clock = fixedClock(Temporal.Instant.from("2026-08-30T09:00:00.123456789Z"));

describe("운영 logging", () => {
  test("완료 record에는 route template과 비민감 allowlist만 남긴다", async () => {
    const module = await import("./logging.module").catch(() => undefined);
    expect(module, "logging boundary must exist").toBeDefined();
    const logger = new module!.RedactingJsonLogger({
      buildSha: "a".repeat(40),
      clock,
      write: () => undefined,
    });
    logger.completion({
      requestId: "req-1",
      method: "GET",
      route: "/api/v1/things/:thingId",
      status: 200,
      duration: milliseconds(12),
    });
    expect(logger.records.at(-1)).toMatchObject({
      timestamp: "2026-08-30T09:00:00.123456789Z",
      service: "eatbid-server",
      requestId: "req-1",
      route: "/api/v1/things/:thingId",
      status: 200,
      durationMs: 12,
    });
    expect(JSON.stringify(logger.records)).not.toContain("?token=");
  });

  test("민감 error fixture를 직렬화 log에 넣지 않는다", async () => {
    const { RedactingJsonLogger, writeSafeFailure } = await import("./logging.module");
    const lines: string[] = [];
    const logger = new RedactingJsonLogger({
      buildSha: "b".repeat(40),
      clock,
      write: (line) => lines.push(line),
    });
    const secrets = [
      "Basic YWRtaW46YmFzaWMtc2VjcmV0",
      "Bearer bearer.secret+complete/token==",
      "Cookie: session=cookie-secret; preference=second-cookie-secret",
      "/path?raw=query-secret",
      'requestBody={"password":"body-secret"}',
      'responseBody={"token":"response-secret"}',
      'requestBody: {"password":"colon-body-secret"}',
      "person@example.com",
      "shareToken=share-supersecret",
      "shareToken: colon-share-supersecret",
      "123-45-67890",
      "multiline-secret-first\nmultiline-secret-second",
    ];
    const nested = new Error(secrets.at(-1), { cause: { payload: secrets.join("\n") } });
    const error = new TypeError(secrets.join("\n"), { cause: nested });
    Object.assign(error, { code: "EADDRINUSE", name: "Bearer hidden-in-name" });
    Object.assign(nested, { code: "shareToken: hidden-in-code" });
    error.stack = `TypeError: ${secrets.join("\n")}\n    at ${secrets[3]}:1:1`;
    logger.defect({ requestId: "req-2", route: "/api/v1/fail", error });
    logger.error(secrets.join("\n"), "UnsafeContext");
    writeSafeFailure("bootstrap_failed", error, clock, (line) => lines.push(line));
    const serialized = lines.join("\n");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    for (const secretFragment of [
      "YWRtaW46YmFzaWMtc2VjcmV0",
      "bearer.secret+complete/token==",
      "cookie-secret",
      "second-cookie-secret",
      "colon-body-secret",
      "colon-share-supersecret",
      "multiline-secret-first",
      "multiline-secret-second",
      "hidden-in-name",
      "hidden-in-code",
    ]) expect(serialized).not.toContain(secretFragment);
    expect(serialized).toContain("req-2");
    expect(serialized).toContain('"errorName":"TypeError"');
    expect(serialized).toContain('"errorCode":"EADDRINUSE"');
    expect(serialized).toContain('"causeClassification":"error"');
    expect(serialized).toContain('"causeClassification":"non_error"');
    for (const line of lines) expect(() => JSON.parse(line)).not.toThrow();
  });

  test("악의적 error accessor도 안전한 fallback logging을 깨뜨리지 못한다", async () => {
    const { writeSafeFailure } = await import("./logging.module");
    const hostile = new Error("raw-secret");
    Object.defineProperties(hostile, {
      stack: { configurable: true, get: () => ({ payload: "stack-secret" }) },
      code: { configurable: true, get: () => { throw new Error("code-secret"); } },
      cause: { configurable: true, get: () => { throw new Error("cause-secret"); } },
    });
    const lines: string[] = [];
    expect(() => writeSafeFailure(
      "bootstrap_failed",
      hostile,
      clock,
      (line) => lines.push(line),
    )).not.toThrow();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).timestamp).toBe("2026-08-30T09:00:00.123456789Z");
    expect(lines[0]).not.toContain("secret");
    expect(() => JSON.parse(lines[0]!)).not.toThrow();
  });
});
