// docker PostgreSQL이 필요한 통합 테스트이며 `database.integration.test.ts`와 같은 관행을 따른다.
import { describe, expect, test } from "bun:test";
import { docker, taskLabel, withSeededDatabase } from "../../fixtures/organization-attempts.fixture";
import { drizzle } from "drizzle-orm/postgres-js";
import request from "supertest";
import { auctionV1Operations, organizationV1Operations } from "@eatbid/contracts";
import { fixedClock, Temporal } from "@eatbid/domain";
import { createApp } from "../bootstrap/create-app";
import { parseEnvironment } from "../platform/config/environment";
import type {
  OrganizationAttemptListing,
  OrganizationAttemptPage,
} from "../modules/procurement/application/organization-attempt-reader";
import { organizationId } from "../modules/procurement/domain/organization-id";
import { DrizzleOrganizationAttemptReader } from "../modules/procurement/infrastructure/drizzle/drizzle-organization-attempt-reader";

// 운영 표본을 본뜬 시나리오다: 개찰 시각이 지난 회차(101·102), 개찰 시각 미관측(103), 개찰 예정이 아직
// 오지 않은 회차(105). 오늘이 09-06이면 표에는 101·102만 실려야 한다(EAT-81).
const NOW = Temporal.Instant.from("2026-09-06T00:00:00Z");

function pageOf(listing: OrganizationAttemptListing): OrganizationAttemptPage {
  if (listing.kind !== "page") throw new Error(`expected a page but got ${listing.kind}`);
  return listing.page;
}

describe("mart 기관 회차 이력 PostgreSQL 경계", () => {
  test("keyset 페이징과 품목 필터가 실제 mart 행에서 표본 수와 순서를 보존한다", async () => {
    await withSeededDatabase(async ({ url, client }) => {
      const reader = new DrizzleOrganizationAttemptReader(drizzle({ client }));
      expect(await reader.exists(organizationId(41n))).toBe(true);
      expect(await reader.exists(organizationId(9_007_199_254_740_993n))).toBe(false);

      // 개찰 기준이 없으면(any) 개찰 예정·미관측 회차까지 전부 최근 순이다.
      const first = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: null,
        limit: 3,
        openedAtOrBefore: null,
      }));
      expect(first.attempts.map((attempt) => attempt.attemptId)).toEqual([105n, 103n, 102n]);
      expect(first.nextCursor).toBe(102n);
      expect(first.sampleCount).toBe(4);
      expect(first.attempts[0]!.openedAt!.toString()).toBe("2026-09-09T05:00:00Z");
      expect(first.attempts[1]!.openedAt).toBeNull();
      expect(first.attempts[1]).toMatchObject({
        item: { codeValueId: 7n, label: "축산" },
        floorRate: "90.000",
        baseAmount: { amount: "2761700.00", currency: "KRW" },
        winRate: null,
        listCount: 17,
        // 유효·무효 판정은 우리가 하지 않는다. 우리가 센 것은 그날 하한 미만 명단 행 수뿐이다.
        belowDayFloorCount: 2,
      });
      // 계보는 행이 아니라 이 페이지를 읽은 활성 build 하나가 갖는다.
      expect(first.lineage).toMatchObject({
        buildId: 501n,
        sourceReleaseId: "00000000-0000-0000-0000-000000000141",
        calcVersion: "mart-r1",
        regionScheme: "eat:auction-location-sigungu",
        coverage: "unknown",
      });
      expect(first.lineage!.computedAt.toString()).toBe("2026-09-04T00:10:00Z");
      expect(first.attempts[1]!.announcedAt.toString()).toBe("2026-09-03T00:00:00Z");
      expect(first.attempts[2]).toMatchObject({
        winRate: "90.309",
        secondRate: "90.412",
        // 같은 낙찰의 투찰률 축 표현이다. 사정률 90.309와 값이 달라야 두 열이 섞이지 않았다는 뜻이다.
        awardedBidRate: "89.4059",
        // 그날 하한도 투찰률 축이라 넷째 자리를 반올림 없이 옮긴다.
        dayFloorRate: "89.1000",
        belowDayFloorCount: 0,
        winnerSupplierPartyId: 77n,
      });

      const second = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: first.nextCursor,
        limit: 2,
        openedAtOrBefore: null,
      }));
      // 라벨 없는 품목은 코드가 있어도 unknown으로 남으며 표본 수는 cursor와 무관하게 같다.
      expect(second.attempts.map((attempt) => attempt.attemptId)).toEqual([101n]);
      expect(second.attempts[0]!.item).toBeNull();
      expect(second.nextCursor).toBeNull();
      expect(second.sampleCount).toBe(4);

      // 개찰 기준이 있으면 기준 이하로 개찰된 회차만이다. 개찰 예정(105)과 미관측(103)은 표본에서도 빠진다.
      const opened = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: null,
        limit: 12,
        openedAtOrBefore: NOW,
      }));
      expect(opened.attempts.map((attempt) => attempt.attemptId)).toEqual([102n, 101n]);
      expect(opened.sampleCount).toBe(2);
      // 개찰 시각과 같은 순간은 포함이다. 개찰 직후 회차가 다음 tick까지 표에서 사라지면 안 된다.
      const justOpened = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: null,
        limit: 12,
        openedAtOrBefore: Temporal.Instant.from("2026-09-09T05:00:00Z"),
      }));
      expect(justOpened.attempts.map((attempt) => attempt.attemptId)).toEqual([105n, 102n, 101n]);
      expect(justOpened.sampleCount).toBe(3);

      const filtered = pageOf(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: 7n,
        cursor: null,
        limit: 12,
        openedAtOrBefore: null,
      }));
      expect(filtered.attempts.map((attempt) => attempt.attemptId)).toEqual([105n, 103n, 101n]);
      expect(filtered.sampleCount).toBe(3);

      const empty = pageOf(await reader.listAttempts({
        organizationId: organizationId(43n),
        itemCodeValueId: 9n,
        cursor: null,
        limit: 12,
        openedAtOrBefore: null,
      }));
      expect(empty.attempts).toEqual([]);
      expect(empty.sampleCount).toBe(0);

      // 104는 기관 43의 회차이고 9007199254740993은 존재하지 않는다. 둘 다 빈 페이지가 아니라 명시적 실패다.
      expect(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: 104n,
        limit: 12,
        openedAtOrBefore: null,
      })).toEqual({ kind: "cursor-not-found", cursor: 104n });
      expect(await reader.listAttempts({
        organizationId: organizationId(41n),
        itemCodeValueId: null,
        cursor: 9_007_199_254_740_993n,
        limit: 12,
        openedAtOrBefore: null,
      })).toEqual({ kind: "cursor-not-found", cursor: 9_007_199_254_740_993n });

      const runtime = await createApp({
        environment: parseEnvironment({ NODE_ENV: "test", PORT: "0", DATABASE_URL: url }),
        logWriter: () => undefined,
        clock: fixedClock(NOW),
      });
      const server = await runtime.listen(0, "127.0.0.1");
      try {
        const response = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "41" },
            query: { limit: 1 },
          }),
        );
        expect(response.status).toBe(200);
        // query를 생략한 HTTP 기본값은 개찰된 회차만이다. 개찰 예정 105와 미관측 103은 첫 행이 아니다.
        expect(response.body.attempts).toEqual([{
          attemptId: "102",
          announcedAt: "2026-09-02T00:00:00Z",
          openedAt: "2026-09-04T05:00:00Z",
          item: { codeValueId: "9", label: "농산" },
          floorRate: { value: "90.000", unit: "percentage-points" },
          baseAmount: { amount: "1000000.00", currency: "KRW" },
          winRate: { value: "90.309", unit: "percentage-points" },
          secondRate: { value: "90.412", unit: "percentage-points" },
          awardedBidRate: { value: "89.4059", unit: "percentage-points" },
          dayFloorRate: { value: "89.1000", unit: "percentage-points" },
          listCount: 5,
          belowDayFloorCount: 0,
          winnerSupplierPartyId: "77",
          supersedesAttemptId: null,
        }]);
        expect(response.body.nextCursor).toBe("102");
        expect(response.body.meta).toEqual({
          sampleCount: 2,
          item: null,
          opened: "only",
          asOf: "2026-09-06T00:00:00Z",
          buildId: "501",
          sourceReleaseId: "00000000-0000-0000-0000-000000000141",
          calcVersion: "mart-r1",
          computedAt: "2026-09-04T00:10:00Z",
          // 두 보유율 행 중 가장 나쁜 값이다. 지금 수집 구간에는 시도 축이 없어 unknown이 이긴다.
          coverage: "unknown",
          regionScheme: "eat:auction-location-sigungu",
        });
        const anyAttempt = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "41" },
            query: { limit: 1, opened: "any" },
          }),
        );
        expect(anyAttempt.status).toBe(200);
        expect(anyAttempt.body.attempts.map((attempt: { attemptId: string }) => attempt.attemptId)).toEqual(["105"]);
        expect(anyAttempt.body.meta).toMatchObject({ sampleCount: 4, opened: "any", asOf: null });
        const foreignCursor = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "41" },
            query: { cursor: "104" },
          }),
        );
        expect(foreignCursor.status).toBe(400);
        expect(foreignCursor.body.code).toBe("VALIDATION_ERROR");
        const auction = await request(server).get(
          auctionV1Operations.find.buildPath({ path: { auctionId: "103" } }),
        );
        expect(auction.status).toBe(200);
        expect(auction.body.organization).toEqual({
          organizationId: "41",
          name: "창원 남산초등학교",
          type: "school",
        });
        const missing = await request(server).get(
          organizationV1Operations.listAuctionAttempts.buildPath({
            path: { organizationId: "9007199254740993" },
          }),
        );
        expect(missing.status).toBe(404);
        expect(missing.body.code).toBe("ORGANIZATION_NOT_FOUND");
      } finally {
        await runtime.shutdown();
      }
    });
    expect(await docker("ps", "-a", "--filter", `label=${taskLabel}`, "--format", "{{.Names}}")).toBe("");
  }, 180_000);
});
