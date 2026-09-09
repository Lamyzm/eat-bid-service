import { expect, test } from "bun:test";
import request from "supertest";
import { organizationV1Operations, organizationAuctionAttemptsV1ResponseSchema } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";
import { signedInSessionAuthenticator } from "../../fixtures/session-authenticator.fixture";

test("PostgreSQL의 100 초과 관측률이 기관 회차 HTTP 200과 정확한 문자열로 전달된다", async () => {
  await withSeededDatabase(async ({ url }) => {
    const runtime = await createApp({
      environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: url }),
      logWriter: () => undefined,
      clock: fixedClock(Temporal.Instant.from("2026-09-06T00:00:00Z")),
      sessionAuthenticator: signedInSessionAuthenticator,
    });
    const server = await runtime.listen(0, "127.0.0.1");
    try {
      const response = await request(server).get(
        organizationV1Operations.listAuctionAttempts.buildPath({
          path: { organizationId: "41" }, query: { limit: 200, opened: "only" },
        }),
      );
      expect(response.status).toBe(200);
      const parsed = organizationAuctionAttemptsV1ResponseSchema.parse(response.body);
      expect(parsed.attempts[0]).toMatchObject({
        attemptId: "102",
        floorRate: { value: "90.000", unit: "percentage-points" },
        winRate: { value: "101.975", unit: "percentage-points" },
        secondRate: { value: "102.297", unit: "percentage-points" },
      });
      expect(parsed.attempts[1]?.secondRate).toBeNull();
      expect(parsed.meta).toMatchObject({ sampleCount: 2, buildId: "501", opened: "only" });
    } finally {
      await runtime.shutdown();
    }
  }, async (client) => {
    // 관측률만 교체해 같은 DB→adapter→use case→HTTP 경계를 통과시킨다. 활성화 전 fixture 준비다.
    await client`update mart.org_round_summary
      set awarded_assessment_rate = '101.975', runner_up_assessment_rate = '102.297'
      where build_id = 501 and auction_attempt_id = 102`;
  });
}, 180_000);
