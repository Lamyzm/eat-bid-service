import { describe, expect, test } from "bun:test";

describe("operational logging", () => {
  test("completion records contain only the route template and non-sensitive allowlist", async () => {
    const module = await import("./logging.module").catch(() => undefined);
    expect(module, "logging boundary must exist").toBeDefined();
    const logger = new module!.RedactingJsonLogger({ buildSha: "a".repeat(40), write: () => undefined });
    logger.completion({
      requestId: "req-1",
      method: "GET",
      route: "/api/v1/things/:thingId",
      status: 200,
      durationMs: 12,
    });
    expect(logger.records.at(-1)).toMatchObject({
      service: "eatbid-server",
      requestId: "req-1",
      route: "/api/v1/things/:thingId",
      status: 200,
    });
    expect(JSON.stringify(logger.records)).not.toContain("?token=");
  });

  test("sensitive error fixtures never enter serialized logs", async () => {
    const { RedactingJsonLogger } = await import("./logging.module");
    const lines: string[] = [];
    const logger = new RedactingJsonLogger({ buildSha: "b".repeat(40), write: (line) => lines.push(line) });
    const secrets = [
      "Bearer authorization-secret",
      "Cookie: session=cookie-secret",
      "/path?raw=query-secret",
      'requestBody={"password":"body-secret"}',
      'responseBody={"token":"response-secret"}',
      "person@example.com",
      "shareToken=share-supersecret",
      "123-45-67890",
    ];
    logger.defect({ requestId: "req-2", route: "/api/v1/fail", error: new Error(secrets.join(" ")) });
    const serialized = lines.join("\n");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    expect(serialized).toContain("req-2");
  });
});
