import { describe, expect, test } from "bun:test";
import { baseRelativeBidRate, bidRate, canonicalDecimal, fixedClock, krw, observedBidRate, Temporal } from "@eatbid/domain";
import { EffectRunner } from "../../../platform/effect/effect-runner";
import type { OrganizationAttemptQuery } from "./organization-attempt-reader";

const record = {
  attemptId: 5_796_468n,
  revisionId: 208n,
  announcedAt: Temporal.Instant.from("2026-09-01T00:00:00Z"),
  openedAt: null,
  item: { codeValueId: 7n, label: "축산" },
  itemLabel: "축산",
  floorRate: bidRate(canonicalDecimal("90.000", 3)),
  awardMethodCodeValueId: null,
  baseAmount: krw(canonicalDecimal("2761700.00", 2)),
  winRate: observedBidRate(canonicalDecimal("90.309", 3)),
  secondRate: null,
  // 같은 낙찰의 투찰률 축 표현이다. 사정률 90.309와 값이 다른 것이 축이 다르다는 증거다.
  awardedBidRate: baseRelativeBidRate(canonicalDecimal("88.3020", 4)),
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

const query = { organizationId: 42n, itemCodeValueId: null, cursor: null, limit: 12, opened: "only" } as const;
const pagedReader = (kind: "page", attempts: readonly (typeof record)[] = [record]) => ({
  exists: async () => true,
  listAttempts: async () => ({
    kind,
    page: { attempts, nextCursor: null, sampleCount: attempts.length, lineage },
  }),
});

// 개찰 기준 시각은 clock에서만 온다. 고정 clock이어야 응답의 asOf를 문자 그대로 검사할 수 있다.
const NOW = Temporal.Instant.from("2026-09-06T01:00:00Z");
const clock = fixedClock(NOW);

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
    }, clock);
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
      awardedBidRate: { value: "88.3020", unit: "percentage-points" },
      dayFloorRate: { value: "88.0350", unit: "percentage-points" },
      listCount: 17,
      belowDayFloorCount: 2,
      winnerSupplierPartyId: "9",
      supersedesAttemptId: null,
    }]);
    expect(response.meta).toEqual({
      sampleCount: 92,
      item: null,
      opened: "only",
      asOf: "2026-09-06T01:00:00Z",
      buildId: "501",
      sourceReleaseId: "0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f",
      calcVersion: "mart-r1",
      computedAt: "2026-09-04T00:10:00Z",
      coverage: "unknown",
      regionScheme: "eat:auction-location-sigungu",
    });
  });

  test("opened가 only면 clock 시각을 개찰 기준으로 reader에 넘기고 any면 기준 없이 읽는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const observed: OrganizationAttemptQuery[] = [];
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async (readerQuery) => {
        observed.push(readerQuery);
        return { kind: "page", page: { attempts: [], nextCursor: null, sampleCount: 0, lineage } };
      },
    }, clock);
    const runner = new EffectRunner();
    const onlyOpened = await runner.run(useCase.execute(query));
    const anyAttempt = await runner.run(useCase.execute({ ...query, opened: "any" }));
    expect(observed.map((item) => item.openedAtOrBefore)).toEqual([NOW, null]);
    // 표본 수 0이 "개찰된 회차가 없다"인지 "회차 자체가 없다"인지는 meta가 말해야 한다(AGENTS 7).
    expect(onlyOpened.meta).toMatchObject({ opened: "only", asOf: "2026-09-06T01:00:00Z" });
    expect(anyAttempt.meta).toMatchObject({ opened: "any", asOf: null });
  });

  test("품목을 지정한 조회는 meta.item에 요청 품목을 그대로 되돌려 싣는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({
        kind: "page",
        page: { attempts: [record], nextCursor: null, sampleCount: 20, lineage },
      }),
    }, clock);
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
    }, clock);
    const response = await new EffectRunner().run(useCase.execute(query));
    expect(response.attempts).toEqual([]);
    expect(response.meta).toEqual({
      sampleCount: 0,
      item: null,
      opened: "only",
      asOf: "2026-09-06T01:00:00Z",
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
    }, clock);
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
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({ ...query, cursor: 5_796_468n })))
      .rejects.toMatchObject({
        name: "AttemptCursorInvalid",
        code: "VALIDATION_ERROR",
        organizationId: 42n,
        cursor: 5_796_468n,
      });
  });

  test("revision은 요청한 조회에만 실리고 기본 조회 응답에는 자리가 없다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const runner = new EffectRunner();
    const useCase = new application.ListOrganizationAuctionAttempts(pagedReader("page"), clock);

    const withoutRevision = await runner.run(useCase.execute(query));
    // 값이 없으면 JSON 경계에서 key 자체가 사라진다. 구 소비자의 strict parse가 이 위에 서 있다.
    expect(withoutRevision.attempts[0]?.revisionId).toBeUndefined();
    expect(JSON.parse(JSON.stringify(withoutRevision.attempts[0]))).not.toHaveProperty("revisionId");
    const withRevision = await runner.run(useCase.execute({ ...query, includeRevision: true }));
    // mart 요약이 요약한 그 해석이며 최신 revision을 다시 고른 값이 아니다.
    expect(withRevision.attempts[0]?.revisionId).toBe("208");
  });

  test("이어 읽기는 첫 페이지의 asOf를 그대로 기준으로 쓰고 build를 reader에 넘긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const observed: OrganizationAttemptQuery[] = [];
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async (readerQuery) => {
        observed.push(readerQuery);
        return { kind: "page", page: { attempts: [], nextCursor: null, sampleCount: 0, lineage } };
      },
    }, clock);
    const pinned = Temporal.Instant.from("2026-09-05T00:00:00Z");
    const response = await new EffectRunner().run(useCase.execute({
      ...query,
      expectedBuildId: 501n,
      asOf: pinned,
    }));

    // clock을 다시 읽으면 그 사이 개찰된 회차가 누적 목록에 새로 끼어든다.
    expect(observed[0]?.openedAtOrBefore).toBe(pinned);
    expect(observed[0]?.expectedBuildId).toBe(501n);
    // 응답 meta는 실제로 비교한 기준을 되돌려야 소비자가 다음 페이지에 같은 값을 보낼 수 있다.
    expect(response.meta.asOf).toBe("2026-09-05T00:00:00Z");
  });

  test("첫 페이지가 볼 수 없었던 미래 asOf는 요청 오류로 닫는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    let listed = 0;
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => { listed += 1; return true; },
      listAttempts: async () => ({ kind: "page", page: { attempts: [], nextCursor: null, sampleCount: 0, lineage } }),
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({
      ...query,
      expectedBuildId: 501n,
      asOf: Temporal.Instant.from("2026-09-06T01:00:00.000000001Z"),
    }))).rejects.toMatchObject({ name: "AttemptAsOfInFuture", code: "VALIDATION_ERROR" });
    // 판정이 저장소보다 앞서야 잘못된 기준으로 만든 페이지가 애초에 만들어지지 않는다.
    expect(listed).toBe(0);
  });

  test("고정한 build가 활성이 아니면 cursor 오류가 아니라 재조회 충돌로 닫는다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const useCase = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => ({ kind: "build-changed", expectedBuildId: 501n, activeBuildId: 502n }),
    }, clock);
    await expect(new EffectRunner().run(useCase.execute({ ...query, expectedBuildId: 501n, asOf: NOW })))
      .rejects.toMatchObject({
        name: "AttemptBuildChanged",
        code: "CONFLICT",
        expectedBuildId: 501n,
        activeBuildId: 502n,
      });
  });

  test("저장소 장애는 AuctionDependencyUnavailable로 번역하고 원문을 숨긴다", async () => {
    const application = await import("./list-organization-auction-attempts");
    const runner = new EffectRunner();
    const existsFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => { throw new Error("credential=must-not-escape"); },
      listAttempts: async () => { throw new Error("unreachable"); },
    }, clock);
    await expect(runner.run(existsFailure.execute(query))).rejects.toMatchObject({
      name: "AuctionDependencyUnavailable",
      code: "DEPENDENCY_UNAVAILABLE",
    });
    const listFailure = new application.ListOrganizationAuctionAttempts({
      exists: async () => true,
      listAttempts: async () => { throw new Error("credential=must-not-escape"); },
    }, clock);
    const failure = await runner.run(listFailure.execute(query)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ name: "AuctionDependencyUnavailable", code: "DEPENDENCY_UNAVAILABLE" });
    expect(String(failure)).not.toContain("must-not-escape");
  });
});
