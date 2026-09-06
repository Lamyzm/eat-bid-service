import { describe, expect, test } from "bun:test";
import { baseRelativeBidRate, bidRate, canonicalDecimal, krw, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";

const record = {
  attemptId: 5_796_468n,
  announcedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  openedAt: null,
  item: { codeValueId: 7n, label: "축산" },
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  winRate: bidRate(canonicalDecimal("90.309", 3)),
  secondRate: null,
  dayFloorRate: baseRelativeBidRate(canonicalDecimal("88.0350", 4)),
  listCount: 17,
  belowDayFloorCount: 2,
  winnerSupplierPartyId: 9n,
  supersedesAttemptId: null,
} as const;

// 계보는 행이 아니라 이 페이지를 읽은 build 하나가 갖는다(ADR 0034).
const lineage = {
  buildId: 501n,
  sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
  calcVersion: "mart-r1",
  computedAt: Temporal.Instant.from("2026-09-04T00:10:00Z"),
  coverage: "unknown",
  regionScheme: "eat:auction-location-sigungu",
} as const;

const query = { organizationId: 42n, itemCodeValueId: null, cursor: null, limit: 12 } as const;

describe("ListOrganizationAuctionAttempts 조회 use case", () => {
  test("회차 요약을 공개 응답으로 직렬화하고 meta는 활성 build의 계보를 싣는다", async () => {
    const application = await import("./list-organization-auction-attempts").catch(() => undefined);
    expect(application, "기관 회차 이력 use case가 있어야 한다").toBeDefined();
    const useCase = new application!.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({
        kind: "page",
        page: { attempts: [record], nextCursor: 5_796_468n, sampleCount: 92, lineage },
      }),
    });
    const response = await new EffectRunner().run(useCase.execute(query));
    expect(response.organizationId).toBe("42");
    expect(response.nextCursor).toBe("5796468");
    expect(response.attempts).toEqual([{
      attemptId: "5796468",
      announcedAt: "2026-09-01T00:00:00Z",
      openedAt: null,
      item: { codeValueId: "7", label: "축산" },
      floorRate: { value: "90.000", unit: "percentage-points" },
      baseAmount: { amount: "2761700.00", currency: "KRW" },
      winRate: { value: "90.309", unit: "percentage-points" },
      secondRate: null,
      dayFloorRate: { value: "88.0350", unit: "percentage-points" },
      listCount: 17,
      belowDayFloorCount: 2,
      winnerSupplierPartyId: "9",
      supersedesAttemptId: null,
    }]);
    expect(response.meta).toEqual({
      sampleCount: 92,
      item: null,
      buildId: "501",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:10:00Z",
      coverage: "unknown",
      regionScheme: "eat:auction-location-sigungu",
    });
  });

  test("품목을 지정한 조회는 meta.item에 요청 품목을 그대로 되돌려 싣는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({
        kind: "page",
        page: { attempts: [record], nextCursor: null, sampleCount: 20, lineage },
      }),
    });
    const response = await new EffectRunner().run(useCase.execute({ ...query, itemCodeValueId: 7n }));
    expect(response.meta.item).toBe("7");
    expect(response.meta.sampleCount).toBe(20);
  });

  test("활성 build가 없으면 계보 전체가 null인 빈 목록이고 실패하지 않는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({
        kind: "page",
        page: { attempts: [], nextCursor: null, sampleCount: 0, lineage: null },
      }),
    });
    const response = await new EffectRunner().run(useCase.execute(query));
    expect(response.attempts).toEqual([]);
    expect(response.meta).toEqual({
      sampleCount: 0,
      item: null,
      buildId: null,
      sourceReleaseId: null,
      calcVersion: null,
      computedAt: null,
      coverage: null,
      regionScheme: null,
    });
  });

  test("기관이 없으면 OrganizationNotFound로 실패하고 목록은 읽지 않는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    let listed = 0;
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => false,
      listAttempts: async () => {
        listed += 1;
        throw new Error("unreachable");
      },
    });
    await expect(new EffectRunner().run(useCase.execute(query))).rejects.toMatchObject({
      name: "OrganizationNotFound",
      code: "ORGANIZATION_NOT_FOUND",
      organizationId: 42n,
    });
    expect(listed).toBe(0);
  });

  test("다른 기관이나 사라진 cursor는 AttemptCursorInvalid로 닫고 빈 목록으로 위장하지 않는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "cursor-not-found", cursor: 5_796_468n }),
    });
    await expect(new EffectRunner().run(useCase.execute({ ...query, cursor: 5_796_468n })))
      .rejects.toMatchObject({
        name: "AttemptCursorInvalid",
        code: "VALIDATION_ERROR",
        organizationId: 42n,
        cursor: 5_796_468n,
      });
  });

  test("저장소 장애는 AuctionDependencyUnavailable로 번역하고 원문을 숨긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const runner = new EffectRunner();
    const existsFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => { throw new Error("credential=must-not-escape"); },
      listAttempts: async () => { throw new Error("unreachable"); },
    });
    await expect(runner.run(existsFailure.execute(query))).rejects.toMatchObject({
      name: "AuctionDependencyUnavailable",
      code: "DEPENDENCY_UNAVAILABLE",
    });
    const listFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => { throw new Error("credential=must-not-escape"); },
    });
    const failure = await runner.run(listFailure.execute(query)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "AuctionDependencyUnavailable", code: "DEPENDENCY_UNAVAILABLE" });
    expect(String(failure)).not.toContain("must-not-escape");
  });
});
