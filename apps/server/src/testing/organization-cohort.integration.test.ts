import { expect, test } from "bun:test";
import request from "supertest";
import { organizationV1Operations } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import { withSeededDatabase } from "../../fixtures/organization-attempts.fixture";

test("기관 회차 HTTP의 집단별 전체 개수와 cursor 및 KST 개찰월이 함께 일치한다", async () => {
  await withSeededDatabase(async ({ url }) => {
    const runtime = await createApp({
      environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: url }),
      logWriter: () => undefined,
      clock: fixedClock(Temporal.Instant.from("2026-09-10T00:00:00Z")),
    });
    const server = await runtime.listen(0, "127.0.0.1");
    // operation의 기본 query는 제거하고 각 사례가 자기 query를 한 번만 전달한다.
    const path = organizationV1Operations.listAuctionAttempts.buildPath({ path: { organizationId: "41" } }).split("?")[0]!;
    const read = (query: Record<string, string | number>) => request(server).get(path).query({ opened: "any", ...query });
    try {
      const first = await read({ floorRate: "88.000", awardMethod: "31", limit: 1 });
      expect(first.status).toBe(200);
      expect(first.body.attempts.map((row: { attemptId: string }) => row.attemptId)).toEqual(["105"]);
      expect(first.body.meta).toMatchObject({ sampleCount: 2, cohort: {
        floorRate: { kind: "exact", value: { value: "88.000", unit: "percentage-points" } },
        awardMethod: { kind: "exact", codeValueId: "31" }, period: null,
      } });
      const second = await read({ floorRate: "88.000", awardMethod: "31", limit: 1, cursor: first.body.nextCursor });
      expect(second.status).toBe(200);
      expect(second.body.attempts[0]).toMatchObject({ attemptId: "102", awardMethodCodeValueId: "31", winRate: { value: "101.975" }, secondRate: { value: "102.297" } });
      expect(second.body.meta.sampleCount).toBe(2);
      expect(second.body.nextCursor).toBeNull();
      expect((await read({ floorRate: "88.000", awardMethod: "31", cursor: "103" })).status).toBe(400);
      expect((await read({ floorRate: "all", awardMethod: "31", cursor: "103" })).status).toBe(400);
      const unknown = await read({ floorRate: "unknown", awardMethod: "unknown" });
      expect(unknown.body.attempts.map((row: { attemptId: string }) => row.attemptId)).toEqual(["101"]);
      expect(unknown.body.meta.cohort).toEqual({ floorRate: { kind: "unknown" }, awardMethod: { kind: "unknown" }, period: null });
      expect(unknown.body.attempts[0].awardMethodCodeValueId).toBeNull();
      const all = await read({ floorRate: "all", awardMethod: "all" });
      expect(all.body.meta.sampleCount).toBe(4);
      expect(all.body.attempts).toHaveLength(4);
      // 두 조건이 같은 행을 우연히 고르는 fixture에서도 한 술어가 빠진 회귀를 잡도록 각각 조회한다.
      for (const [filters, ids] of [
        [{ floorRate: "88.000", awardMethod: "all" }, ["105", "102"]],
        [{ floorRate: "90.000", awardMethod: "all" }, ["103"]],
        [{ floorRate: "unknown", awardMethod: "all" }, ["101"]],
        [{ floorRate: "all", awardMethod: "unknown" }, ["101"]],
        [{ floorRate: "all", awardMethod: "31" }, ["105", "102"]],
      ] as const) {
        const result = await read(filters);
        expect(result.status).toBe(200);
        expect(result.body.attempts.map((row: { attemptId: string }) => row.attemptId)).toEqual(ids);
        expect(result.body.meta.sampleCount).toBe(ids.length);
      }
      const august = await read({ from: "2026-08", to: "2026-08" });
      expect(august.body.attempts.map((row: { attemptId: string }) => row.attemptId)).toEqual(["102"]);
      expect(august.body.meta.sampleCount).toBe(1);
      expect(august.body.meta.cohort.period).toEqual({ from: "2026-08", to: "2026-08" });
      const september = await read({ from: "2026-09", to: "2026-09" });
      expect(september.body.attempts.map((row: { attemptId: string }) => row.attemptId)).toEqual(["105", "103"]);
      expect((await read({ from: "2026-09", to: "2026-09", cursor: "102" })).status).toBe(400);
      const legacy = await read({});
      expect(legacy.status).toBe(200);
      expect(legacy.body.meta).not.toHaveProperty("cohort");
      expect(legacy.body.attempts.every((row: object) => !("awardMethodCodeValueId" in row))).toBe(true);
      expect((await read({ floorRate: "100.001" })).status).toBe(400);
      expect((await read({ from: "2026-09" })).status).toBe(400);
    } finally { await runtime.shutdown(); }
  }, async (client) => {
    await client`insert into core.code_scheme (code_scheme_id, namespace, owner, version_policy, valid_time_policy)
      overriding system value values (12, 'eat.award-method', 'eat', 'immutable', 'open')`;
    await client`insert into core.code_value (code_value_id, code_scheme_id, code)
      overriding system value values (31, 12, '001'), (32, 12, '013')`;
    await client`update mart.org_round_summary set floor_rate = 88.000, award_method_code_value_id = 31
      where build_id = 501 and auction_attempt_id in (102, 105)`;
    await client`update mart.org_round_summary set award_method_code_value_id = 32, opened_at = '2026-08-31T15:00:00Z'
      where build_id = 501 and auction_attempt_id = 103`;
    await client`update mart.org_round_summary set opened_at = '2026-08-31T14:59:59.999999Z',
      awarded_assessment_rate = 101.975, runner_up_assessment_rate = 102.297 where build_id = 501 and auction_attempt_id = 102`;
    await client`update mart.org_round_summary set opened_at = null where build_id = 501 and auction_attempt_id = 101`;
  });
}, 180_000);
